/**
 * PPTX extraction via direct OOXML parsing.
 *
 * ARCHITECTURE.md permits a custom XML parser, and that is what this is: the
 * maintained Node PPTX packages do not reliably surface speaker notes, which
 * the MVP requires (PRD §1).
 *
 * Shape of the archive we care about:
 *   ppt/presentation.xml            <p:sldIdLst> — authoritative slide ORDER
 *   ppt/_rels/presentation.xml.rels r:id -> ppt/slides/slideN.xml
 *   ppt/slides/slideN.xml           title, body text, tables, images
 *   ppt/slides/_rels/slideN.xml.rels slide -> its notesSlide
 *   ppt/notesSlides/notesSlideN.xml speaker notes
 */
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

import {
  classifyLegibility,
  normalizeText,
  type ExtractedTable,
  type ExtractedUnit,
  type ExtractionResult,
  type ExtractionWarning,
} from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep single children as arrays only where we explicitly normalize below.
  isArray: () => false,
  // Text nodes matter (<a:t>), and whitespace inside them is significant.
  trimValues: false,
  parseTagValue: false,
});

/** Wraps a value that may be a single node, an array, or absent. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

type XmlNode = Record<string, unknown>;

/**
 * Depth-first collection of every value under `root` stored at `tag`.
 *
 * Values may be strings, not just objects: fast-xml-parser represents an
 * element with no attributes and only text (`<a:t>Title</a:t>`) as a bare
 * string, so dropping strings here would silently lose all slide text.
 */
function collectValues(root: unknown, tag: string, out: unknown[] = []) {
  if (root === null || typeof root !== "object") return out;

  if (Array.isArray(root)) {
    for (const item of root) collectValues(item, tag, out);
    return out;
  }

  for (const [key, value] of Object.entries(root as XmlNode)) {
    if (key === tag) {
      for (const node of toArray(value)) {
        if (node !== null && node !== undefined) out.push(node);
      }
    }
    collectValues(value, tag, out);
  }
  return out;
}

/** `collectValues` narrowed to element nodes, for structural tags. */
function collect(root: unknown, tag: string): XmlNode[] {
  return collectValues(root, tag).filter(
    (v): v is XmlNode => v !== null && typeof v === "object",
  );
}

/** The text content of an `<a:t>` value, which may be a string or a node. */
function textValue(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object") {
    const inner = (node as XmlNode)["#text"];
    if (typeof inner === "string") return inner;
  }
  return "";
}

/**
 * Concatenates the `<a:t>` runs inside a shape/paragraph subtree.
 * `<a:p>` boundaries become newlines, which is what preserves bullet
 * structure — without it a slide collapses into one unreadable line.
 */
function textOf(node: unknown): string {
  const paragraphs = collectValues(node, "a:p");
  if (paragraphs.length === 0) return "";

  const lines = paragraphs.map((paragraph) =>
    collectValues(paragraph, "a:t").map(textValue).join(""),
  );

  return normalizeText(lines.join("\n"));
}

/** True when the shape is the slide's title placeholder. */
function isTitleShape(shape: XmlNode): boolean {
  const placeholders = collect(shape, "p:ph");
  return placeholders.some((ph) => {
    const type = ph["@_type"];
    return type === "title" || type === "ctrTitle";
  });
}

function extractTables(slideXml: unknown): ExtractedTable[] {
  return collect(slideXml, "a:tbl").map((tbl) => {
    const rows = collect(tbl, "a:tr").map((tr) =>
      collect(tr, "a:tc").map((tc) => textOf(tc).replace(/\n/g, " ").trim()),
    );

    // Pad ragged rows so consumers can index cells safely.
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      rows: rows.map((row) => [
        ...row,
        ...Array<string>(width - row.length).fill(""),
      ]),
    };
  });
}

/** Resolves `../notesSlides/notesSlide1.xml` against `ppt/slides/`. */
function resolveRelPath(fromDir: string, target: string): string {
  const parts = `${fromDir}/${target}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

type Rel = { id: string; target: string; type: string };

function parseRels(xml: string): Rel[] {
  const parsed = parser.parse(xml) as XmlNode;
  const container = parsed["Relationships"] as XmlNode | undefined;
  return toArray(container?.["Relationship"] as XmlNode | XmlNode[]).map(
    (rel) => ({
      id: String(rel["@_Id"] ?? ""),
      target: String(rel["@_Target"] ?? ""),
      type: String(rel["@_Type"] ?? ""),
    }),
  );
}

export async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const warnings: ExtractionWarning[] = [];

  const read = async (path: string) => {
    const file = zip.file(path);
    return file ? file.async("string") : null;
  };

  // 1. Slide order. <p:sldIdLst> is authoritative — filename order is NOT:
  //    "slide10.xml" sorts before "slide2.xml", and a wrong slide number
  //    silently corrupts every provenance link built on it.
  const presentationXml = await read("ppt/presentation.xml");
  const presentationRels = await read("ppt/_rels/presentation.xml.rels");

  let slidePaths: string[] = [];

  if (presentationXml && presentationRels) {
    const relsById = new Map(
      parseRels(presentationRels).map((rel) => [rel.id, rel.target]),
    );
    const sldIds = collect(parser.parse(presentationXml), "p:sldId");
    slidePaths = sldIds
      .map((sldId) => relsById.get(String(sldId["@_r:id"] ?? "")))
      .filter((target): target is string => Boolean(target))
      .map((target) => resolveRelPath("ppt", target));
  }

  if (slidePaths.length === 0) {
    // Fall back to numeric filename sort so a malformed deck still ingests.
    slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => slideNumber(a) - slideNumber(b));

    if (slidePaths.length > 0) {
      warnings.push({
        index: null,
        code: "parse_recovered",
        message:
          "Slide order came from filenames because presentation.xml could not be read; verify slide numbers before trusting provenance links.",
      });
    }
  }

  if (slidePaths.length === 0) {
    return {
      units: [],
      warnings: [
        {
          index: null,
          code: "no_units",
          message: "No slides found in the PPTX archive.",
        },
      ],
    };
  }

  const units: ExtractedUnit[] = [];

  for (const [position, slidePath] of slidePaths.entries()) {
    const index = position + 1; // 1-based, matching PowerPoint's own numbering.
    const slideXmlText = await read(slidePath);
    if (!slideXmlText) {
      warnings.push({
        index,
        code: "unreadable_unit",
        message: `Slide ${index} (${slidePath}) is missing from the archive.`,
      });
      continue;
    }

    const slideXml = parser.parse(slideXmlText);

    // 2. Title vs. body. Tables are pulled separately, so their cell text is
    //    excluded here to avoid duplicating it into rawText.
    const tableNodes = new Set(collect(slideXml, "a:tbl"));
    const shapes = collect(slideXml, "p:sp");

    let title: string | null = null;
    const bodyLines: string[] = [];
    const shapeTexts: string[] = [];

    for (const shape of shapes) {
      if (collect(shape, "a:tbl").some((t) => tableNodes.has(t))) continue;

      const text = textOf(shape);
      if (!text) continue;

      shapeTexts.push(text);

      if (title === null && isTitleShape(shape)) {
        title = text.replace(/\n/g, " ").trim();
      } else {
        bodyLines.push(text);
      }
    }

    // Not every deck uses a real title placeholder — exported and
    // template-free decks often have plain text boxes. Fall back to the first
    // shape's text when it reads like a heading (short and single-line),
    // matching how the PDF extractor infers a title.
    if (title === null && shapeTexts.length > 0) {
      const first = shapeTexts[0];
      if (!first.includes("\n") && first.length <= 120) {
        title = first;
        bodyLines.shift();
      }
    }

    const tables = extractTables(slideXml);

    // 3. Images. <p:pic> covers inserted pictures; SmartArt and charts arrive
    //    as <p:graphicFrame> instead, and both count as a diagram for §3.
    const imageCount =
      collect(slideXml, "p:pic").length +
      collect(slideXml, "p:graphicFrame").length -
      tables.length; // graphicFrames that are tables are not diagrams

    // 4. Speaker notes, via the slide's own rels.
    const speakerNotes = await readSpeakerNotes(zip, slidePath, read);

    const unit: ExtractedUnit = {
      index,
      title,
      rawText: normalizeText(bodyLines.join("\n")),
      speakerNotes,
      tables,
      imageCount: Math.max(imageCount, 0),
    };

    if (classifyLegibility(unit) !== "ok") {
      warnings.push({
        index,
        code: "unreadable_unit",
        message: `Slide ${index} has little or no extractable text; it may be an image-only slide.`,
      });
    }

    units.push(unit);
  }

  return { units, warnings };
}

async function readSpeakerNotes(
  zip: JSZip,
  slidePath: string,
  read: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const dir = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const base = slidePath.slice(slidePath.lastIndexOf("/") + 1);
  const relsXml = await read(`${dir}/_rels/${base}.rels`);
  if (!relsXml) return null;

  const notesRel = parseRels(relsXml).find((rel) =>
    rel.type.endsWith("/notesSlide"),
  );
  if (!notesRel) return null;

  const notesXml = await read(resolveRelPath(dir, notesRel.target));
  if (!notesXml) return null;

  const parsed = parser.parse(notesXml);

  // The notes slide also contains a placeholder echoing the slide number;
  // only the body placeholder holds real notes.
  const noteShapes = collect(parsed, "p:sp").filter((shape) => {
    const placeholders = collect(shape, "p:ph");
    return !placeholders.some((ph) => ph["@_type"] === "sldNum");
  });

  const text = normalizeText(
    noteShapes
      .map((shape) => textOf(shape))
      .filter(Boolean)
      .join("\n"),
  );

  return text || null;
}

function slideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

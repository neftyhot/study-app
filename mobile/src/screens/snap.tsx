/**
 * "Snap your notes": photos of handwritten or printed notes into a deck.
 * One request per photo (the desktop's `scanImage`), a review list to drop
 * the cards that came out wrong, then a new deck in "My notes".
 */
import { Camera, Images, Trash2 } from "lucide-react";
import { useState } from "react";

import type { PickedFile } from "@megan/core/platform/types";
import { MAX_SCAN_IMAGES, SCAN_IMAGE_TYPES, scanImage } from "@megan/core/scan/scan";
import type { ExtractedCard } from "@megan/core/tutor/schemas";

import { useApp } from "../context";
import { createScanDeck, saveScanCards } from "../data/scan";
import { toBase64 } from "../platform/shared";
import { Button, Empty, Notice, Screen, plural } from "../components/ui";

import { errorText } from "./source";

export function SnapScreen() {
  const { db, ai, platform, navigate, selectTab, changed } = useApp();
  const [photos, setPhotos] = useState<PickedFile[]>([]);
  const [cards, setCards] = useState<ExtractedCard[] | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ai) {
    return (
      <Screen title="Snap your notes">
        <Empty title="Snap needs an AI key">
          <p>Reading photos takes a Gemini API key. Add one in Settings.</p>
          <Button onClick={() => selectTab("settings")}>Open Settings</Button>
        </Empty>
      </Screen>
    );
  }
  const provider = ai;

  async function pick(camera: boolean) {
    setError(null);
    try {
      const picked = await platform.files.pickPhotos({ camera, multiple: !camera });
      const usable = picked.filter((file) => !file.type || (SCAN_IMAGE_TYPES as readonly string[]).includes(file.type));
      if (usable.length < picked.length) setError("Some photos were skipped: only JPEG, PNG and WebP can be read.");
      setPhotos((current) => [...current, ...usable].slice(0, MAX_SCAN_IMAGES));
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function read() {
    setError(null);
    const found: ExtractedCard[] = [];
    try {
      for (const [index, photo] of photos.entries()) {
        setProgress(`Reading photo ${index + 1} of ${photos.length}…`);
        found.push(...(await scanImage(provider, { mimeType: photo.type ?? "image/jpeg", data: toBase64(photo.bytes) })));
      }
      setCards(found);
    } catch (cause) {
      setError(errorText(cause));
      if (found.length > 0) setCards(found);
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    if (!cards?.length) return;
    setError(null);
    try {
      const examId = await createScanDeck(db, title || "Scanned notes");
      await saveScanCards(db, examId, cards);
      changed();
      void platform.haptics.impact("success");
      navigate({ name: "deck", examId });
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <Screen title="Snap your notes">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {progress ? <Notice>{progress}</Notice> : null}

      {cards === null ? (
        <>
          <p className="muted">
            Photograph your notes, a whiteboard or a handout. Each photo becomes a few cards you can check before saving. Up to{" "}
            {MAX_SCAN_IMAGES} photos.
          </p>
          <div className="grid-actions">
            <button type="button" className="action" onClick={() => void pick(true)} disabled={!!progress}>
              <Camera aria-hidden />
              <strong>Take a photo</strong>
            </button>
            <button type="button" className="action" onClick={() => void pick(false)} disabled={!!progress}>
              <Images aria-hidden />
              <strong>Choose photos</strong>
            </button>
          </div>
          {photos.length > 0 ? (
            <div className="section">
              <h2 className="section-title">{plural(photos.length, "photo")}</h2>
              <div className="list">
                {photos.map((photo, index) => (
                  <div className="row" key={`${photo.name}:${index}`}>
                    <span className="row-main">
                      <span className="row-title">{photo.name || `Photo ${index + 1}`}</span>
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <Button onClick={() => void read()} disabled={!!progress}>
                Make cards
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Deck name</span>
            <input className="input" value={title} placeholder="Scanned notes" onChange={(e) => setTitle(e.target.value)} />
          </label>
          {cards.length === 0 ? (
            <Empty title="No cards found">
              <p>The photos may be blurry or too dark. Try again with more light.</p>
            </Empty>
          ) : (
            <div className="list">
              {cards.map((card, index) => (
                <div className="row" key={index}>
                  <span className="row-main">
                    <span className="row-title">{card.question}</span>
                    <span className="row-sub">{card.directAnswer}</span>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Drop card ${index + 1}`}
                    onClick={() => setCards((current) => current?.filter((_, i) => i !== index) ?? null)}
                  >
                    <Trash2 aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="inline">
            <Button onClick={() => void save()} disabled={cards.length === 0}>
              Save {plural(cards.length, "card")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCards(null);
                setPhotos([]);
              }}
            >
              Start over
            </Button>
          </div>
        </>
      )}
    </Screen>
  );
}

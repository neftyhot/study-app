/**
 * Live check of the tutor against a real page of the student's own material.
 *
 * Not a unit test: the thing worth knowing is whether a vision model, shown a
 * rendered lecture page, answers from what is on it — and whether it admits
 * when it cannot see something. That cannot be stubbed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getProvider } from "@/lib/llm";
import { askTutor, extractCards } from "@/lib/tutor";

const [, , imageArg] = process.argv;
const path = imageArg ?? "data/uploads/rendered";

async function main() {
  const provider = getProvider();
  console.log(`provider: ${provider.name} / ${provider.model} · vision=${provider.vision}`);

  const image = readFileSync(join(process.cwd(), path));
  const turns = [
    {
      role: "user" as const,
      text: "Break down this diagram step by step. Name each labelled part and say what it does.",
      images: [{ mimeType: "image/png", data: image.toString("base64") }],
    },
  ];

  const answer = await askTutor(provider, turns);
  console.log("\n--- REPLY ---\n");
  console.log(answer.reply);
  console.log("\nbeyondMaterial:", answer.beyondMaterial);
  console.log("suggestions:", answer.suggestions);

  // The rule that matters most: a model looking at a lecture slide it cannot
  // read must say so, because a student revising from an invented label is
  // worse off than one who got no answer at all.
  const blurred = process.env.BLURRY_IMAGE;
  if (blurred) {
    const check = await askTutor(provider, [
      {
        role: "user",
        text: "What structures are labelled in this diagram, and what does each one do?",
        images: [
          { mimeType: "image/png", data: readFileSync(blurred).toString("base64") },
        ],
      },
    ]);
    console.log("\n--- UNREADABLE IMAGE ---\n");
    console.log(check.reply);
  }

  const cards = await extractCards(provider, {
    turns: [...turns, { role: "model" as const, text: answer.reply }],
    instruction: "Make 3 flashcards from this diagram.",
    limit: 3,
  });

  console.log("\n--- CARDS ---");
  for (const card of cards) {
    console.log(`\nQ: ${card.question}\nA: ${card.directAnswer}\n   must say: ${card.essentialPoints.join("; ")}\n   fromMaterial: ${card.fromMaterial}`);
  }
}

main().catch((error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});

/**
 * Which model each provider runs, in the student's terms, and how to pay for
 * a better one.
 *
 * Safe for the browser: Settings and the upgrade dialog read the same table
 * the server builds its model chain from. The app never takes payment — every
 * link goes to the provider's own billing page, on the student's own account.
 */
import type { ApiProviderId } from "@/lib/settings-shared";

export type ModelLevel = "standard" | "thinking";

export const MODEL_LEVELS = ["standard", "thinking"] as const;

export type LevelOption = {
  model: string;
  label: string;
  blurb: string;
  /** Needs billing on the account; a free key falls back to Standard. */
  paid: boolean;
  /** Rough USD per million input / output tokens. */
  price: string;
};

export type ProviderModels = Record<ModelLevel, LevelOption> & {
  /** Cheaper models tried in order when the chosen one fails. */
  fallbacks: string[];
};

export const PROVIDER_MODELS: Record<ApiProviderId, ProviderModels> = {
  gemini: {
    standard: {
      model: "gemini-3.8-flash",
      label: "Standard — Gemini 3.8 Flash",
      blurb: "Fast and free on Google's free tier. Right for most students.",
      paid: false,
      price: "$0.75 / $3.75",
    },
    thinking: {
      model: "gemini-3.1-pro-preview",
      label: "Thinking — Gemini 3.1 Pro",
      blurb: "Reasons more carefully through hard material. Needs billing turned on in Google AI Studio.",
      paid: true,
      price: "$2 / $12",
    },
    fallbacks: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"],
  },
  openai: {
    standard: {
      model: "gpt-6-sol",
      label: "Standard — GPT-6 Sol",
      blurb: "Good answers at a low price.",
      paid: true,
      price: "$2 / $10",
    },
    thinking: {
      model: "gpt-6-astra",
      label: "Thinking — GPT-6 Astra",
      blurb: "OpenAI's strongest reasoning model. Costs about five times as much.",
      paid: true,
      price: "$10 / $50",
    },
    fallbacks: ["gpt-6-sol", "gpt-6-luna"],
  },
  anthropic: {
    standard: {
      model: "claude-sonnet-5",
      label: "Standard — Claude Sonnet 5",
      blurb: "Careful, clear explanations at a moderate price.",
      paid: true,
      price: "$2 / $10",
    },
    thinking: {
      model: "claude-opus-5-5",
      label: "Thinking — Claude Opus 5.5",
      blurb: "Anthropic's most capable everyday model, for the hardest courses.",
      paid: true,
      price: "$4 / $20",
    },
    fallbacks: ["claude-sonnet-5", "claude-haiku-4-5-20251001"],
  },
};

export type BillingGuide = {
  /** Where the one big button goes. */
  billingUrl: string;
  billingButton: string;
  keysUrl: string;
  usageUrl: string;
  /** What the student will see, one screen at a time. */
  steps: string[];
  /** Reassurance before they spend anything. */
  cost: string;
  /** How to tell it worked. */
  done: string;
};

export const BILLING_GUIDES: Record<ApiProviderId, BillingGuide> = {
  gemini: {
    billingUrl: "https://aistudio.google.com/billing",
    billingButton: "Open Google AI Studio billing",
    keysUrl: "https://aistudio.google.com/api-keys",
    usageUrl: "https://aistudio.google.com/usage",
    steps: [
      "Sign in with the same Google account your Gemini key (or Google sign-in) belongs to.",
      "You'll see your project, usually called \"Default Gemini Project\", marked Free tier. Click \"Set up billing\" next to it.",
      "Enter your card details. Google asks for a prepayment of at least $5 — that money becomes credit you spend down, it is not a subscription.",
      "When the project shows \"Paid tier\" (Tier 1), come back here. Your existing key keeps working — you don't need a new one.",
    ],
    cost: "Typical studying costs cents a day. Pro is about $2 per million words read and $12 per million written.",
    done: "Back in the app, choose \"Thinking\" below. If Pro still isn't available, wait a minute — Google can take a moment to switch tiers.",
  },
  openai: {
    billingUrl: "https://platform.openai.com/account/billing/overview",
    billingButton: "Open OpenAI billing",
    keysUrl: "https://platform.openai.com/api-keys",
    usageUrl: "https://platform.openai.com/usage",
    steps: [
      "Sign in with the account your OpenAI key belongs to. (This is the API platform, separate from a ChatGPT subscription.)",
      "Click \"Add payment details\", choose Individual, and enter your card.",
      "Add credit — $5 is the minimum and lasts most students a long time. Leave auto-recharge off if you want a hard cap.",
      "Come back here. Your existing key starts working with the new balance within a minute or two.",
    ],
    cost: "Credit is prepaid: you can never be charged more than you add.",
    done: "Choose \"Thinking\" below for GPT-6 Astra, or keep Standard — both now use your credit.",
  },
  anthropic: {
    billingUrl: "https://platform.claude.com/settings/billing",
    billingButton: "Open Claude billing",
    keysUrl: "https://platform.claude.com/settings/keys",
    usageUrl: "https://platform.claude.com/usage",
    steps: [
      "Sign in with the account your Claude API key belongs to. (This is the developer platform, separate from a Claude.ai subscription.)",
      "Click \"Buy credits\".",
      "Enter your card and an amount — $5 is plenty to start. Leave auto-reload off if you want a hard cap.",
      "Come back here. Your existing key uses the new credit straight away.",
    ],
    cost: "Credit is prepaid: you can never be charged more than you add.",
    done: "Choose \"Thinking\" below for Claude Opus, or keep Standard — both now use your credit.",
  },
};

export function isModelLevel(value: unknown): value is ModelLevel {
  return value === "standard" || value === "thinking";
}

/** The chosen model first, then each fallback not already in the list. */
export function modelChain(provider: ApiProviderId, tier: ModelLevel, chosen?: string): string[] {
  const models = PROVIDER_MODELS[provider];
  const first = tier === "thinking" ? models.thinking.model : chosen ?? models.standard.model;
  return [first, ...models.fallbacks].filter((model, index, all) => all.indexOf(model) === index);
}

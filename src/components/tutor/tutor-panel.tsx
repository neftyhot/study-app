"use client";

/**
 * The tutor drawer.
 *
 * A panel rather than a page, because the question a student has is always
 * about the thing they are already looking at: the slide, the card, the
 * diagram they just failed. Sending the current page costs one button, and
 * what comes back can be turned into cards without leaving the conversation.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ImagePlus,
  Loader2,
  MessageCircleQuestion,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { CardConfirm } from "@/components/tutor/card-confirm";
import { Markdown } from "@/components/tutor/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  askTutorAction,
  extractCardsAction,
  tutorProviderAction,
  type TutorMessage,
} from "@/lib/tutor/actions";
// Imported from the leaf modules, not the barrel: the barrel reaches the
// provider registry, which would drag llama.cpp into the browser bundle.
import { QUICK_PROMPTS } from "@/lib/tutor/prompts";
import type { ExtractedCard } from "@/lib/tutor/schemas";

/** Big enough for a phone screenshot, small enough not to stall a request. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Message = TutorMessage & { beyondMaterial?: boolean; suggestions?: string[] };

export function TutorPanel({
  examId,
  slideId,
  slideLabel,
  trigger,
}: {
  examId: string;
  /** The page on screen, sent with the first question when included. */
  slideId?: string | null;
  slideLabel?: string | null;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [sendSlide, setSendSlide] = useState(Boolean(slideId));
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [drafts, setDrafts] = useState<ExtractedCard[] | null>(null);
  const [model, setModel] = useState<{
    name: string;
    model: string | null;
    vision: boolean;
    error?: string;
  } | null>(null);

  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || model) return;
    void tutorProviderAction().then(setModel);
  }, [open, model]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function attach(files: FileList | File[] | null) {
    if (!files) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} is too large to send. Crop it, or take a smaller screenshot.`);
        continue;
      }

      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      setImages((current) => [...current, url]);
    }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const outgoing: Message = {
      role: "user",
      text: question,
      images: images.length > 0 ? images : undefined,
    };
    const history = [...messages, outgoing];

    setMessages(history);
    setDraft("");
    setImages([]);
    setBusy(true);

    try {
      const result = await askTutorAction({
        messages: history.map(({ role, text, images }) => ({ role, text, images })),
        // The page rides along with the first question only; after that it is
        // already in the conversation the model is being given back.
        slideId: sendSlide && messages.length === 0 ? slideId : null,
      });

      if (!result.ok) {
        toast.error(result.error);
        // The question stays in the transcript: it was asked, and retyping it
        // after a failed request is a waste of the student's time.
        return;
      }

      setMessages((current) => [
        ...current,
        {
          role: "model",
          text: result.reply,
          beyondMaterial: result.beyondMaterial,
          suggestions: result.suggestions,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function makeCards(instruction?: string) {
    setExtracting(true);
    try {
      const result = await extractCardsAction({
        messages: messages.map(({ role, text, images }) => ({ role, text, images })),
        slideId: sendSlide ? slideId : null,
        instruction,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setDrafts(result.cards);
    } finally {
      setExtracting(false);
    }
  }

  const last = messages.at(-1);
  const suggestions = last?.role === "model" ? (last.suggestions ?? []) : [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <MessageCircleQuestion className="size-4" />
            Ask the tutor
          </Button>
        )}
      </SheetTrigger>

      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            AI study tutor
            {model ? (
              <Badge variant="secondary">{model.model ?? model.name}</Badge>
            ) : null}
            {model && !model.vision ? (
              <Badge variant="outline">text only</Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            {model?.error
              ? model.error
              : slideLabel
                ? `Looking at ${slideLabel}. Change the model in Settings.`
                : "Ask about your own material. Change the model in Settings."}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {slideLabel
                  ? `${slideLabel} will be sent with your first question.`
                  : "Attach a screenshot, or just ask."}
              </p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((quick) => (
                  <Button
                    key={quick.label}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void send(quick.prompt)}
                  >
                    {quick.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message, i) => (
            <div
              key={i}
              className={
                message.role === "user"
                  ? "bg-muted ml-6 rounded-md p-3"
                  : "rounded-md border p-3"
              }
            >
              {message.role === "user" ? (
                <p className="text-sm whitespace-pre-wrap">{message.text}</p>
              ) : (
                <Markdown>{message.text}</Markdown>
              )}

              {message.images?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.images.map((image, index) => (
                    // A data URL the student just attached: nothing to optimise
                    // and no remote to fetch.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={index}
                      src={image}
                      alt=""
                      className="h-16 rounded border"
                    />
                  ))}
                </div>
              ) : null}

              {message.beyondMaterial ? (
                <Badge variant="outline" className="mt-2">
                  Goes beyond your material
                </Badge>
              ) : null}

              {message.role === "model" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={extracting}
                    onClick={() =>
                      void makeCards("Turn the facts in the last answer into flashcards.")
                    }
                  >
                    {extracting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    Turn this into flashcards
                  </Button>
                </div>
              ) : null}
            </div>
          ))}

          {busy ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Thinking…
            </p>
          ) : null}

          <div ref={bottom} />
        </div>

        {suggestions.length > 0 && !busy ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                className="h-auto py-1 text-left text-xs whitespace-normal"
                onClick={() => void send(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="space-y-2 border-t pt-3">
          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((image, i) => (
                <div key={i} className="relative">
                  {/* A local data URL, not a remote asset. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="h-14 rounded border" />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() =>
                      setImages((current) => current.filter((_, index) => index !== i))
                    }
                    className="bg-background absolute -top-2 -right-2 rounded-full border p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) void attach(files);
            }}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline, as everywhere else.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder={
              slideId && sendSlide
                ? "Ask about this page…"
                : "Ask a question, or paste a screenshot…"
            }
            rows={2}
            className="resize-none"
          />

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => void attach(event.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="size-4" />
              Image
            </Button>

            {slideId ? (
              <Button
                variant={sendSlide ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSendSlide((current) => !current)}
              >
                {sendSlide ? "Sending this page" : "Send this page"}
              </Button>
            ) : null}

            {messages.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={extracting}
                onClick={() => void makeCards()}
              >
                <Sparkles className="size-4" />
                Make flashcards
              </Button>
            ) : null}

            <Button
              className="ml-auto"
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => void send(draft)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send
            </Button>
          </div>
        </div>
      </SheetContent>

      <CardConfirm
        examId={examId}
        slideId={sendSlide ? slideId : null}
        cards={drafts}
        onClose={(saved) => {
          setDrafts(null);
          if (saved) router.refresh();
        }}
      />
    </Sheet>
  );
}

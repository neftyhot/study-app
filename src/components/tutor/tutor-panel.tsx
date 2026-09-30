"use client";

/**
 * The tutor, in a panel down the right-hand side.
 *
 * It slides in over whatever the student is looking at — the slide, the card,
 * the diagram they just failed — so there is room to read an answer without
 * the page reflowing around it. The whole deck and the numbered flashcards go
 * with every question, the page on screen stays attached for the whole
 * conversation, and each conversation is saved on this computer: reopening one
 * sends its transcript along with the next question, so the tutor picks up
 * where it left off.
 */
import { Children, cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  History,
  ImagePlus,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/lib/notify";

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
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  askTutorAction,
  extractCardsAction,
  tutorProviderAction,
  type TutorMessage,
} from "@/lib/tutor/actions";
import {
  deleteTutorChat,
  getTutorChat,
  listTutorChats,
  saveTutorChat,
  type TutorChatSummary,
} from "@/lib/tutor/chats";
// Imported from the leaf modules, not the barrel: the barrel reaches the
// provider registry, which would drag llama.cpp into the browser bundle.
import { QUICK_PROMPTS } from "@/lib/tutor/prompts";
import type { ExtractedCard } from "@/lib/tutor/schemas";
import { cn } from "@/lib/utils";

/** Big enough for a phone screenshot, small enough not to stall a request. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Message = TutorMessage & {
  beyondMaterial?: boolean;
  suggestions?: string[];
  /** Images sent in a saved chat; the pictures themselves are not kept. */
  imageCount?: number;
};

export function TutorPanel({
  examId,
  slideId,
  slideLabel,
  focus,
  primerSectionId,
  captureScreen = false,
  screenText,
  contextLabel,
  trigger,
  className,
}: {
  examId: string;
  /** The page on screen, kept with the conversation while "Send this page" is on. */
  slideId?: string | null;
  slideLabel?: string | null;
  /** What the student is looking at in words, e.g. the card they were asked. */
  focus?: string | null;
  /** The study-guide concept it was opened from; its topic and cited slides go along. */
  primerSectionId?: string | null;
  /**
   * Screenshot the window as the panel opens and attach it to the first
   * question, so "what does this mean" has the page it is about. Only in the
   * desktop app, and only for a model that can see images.
   */
  captureScreen?: boolean;
  /** The words on screen as the panel opens, for models that can't see the screenshot. */
  screenText?: () => string;
  /** What the tutor has, in place of the default description. */
  contextLabel?: string;
  /** The button that opens it; it toggles the panel open and shut. */
  trigger?: React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }>;
  className?: string;
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

  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** The saved chat this conversation writes to; null until the first answer. */
  const chatId = useRef<string | null>(null);
  // Bumped by New chat and by opening another chat, so an answer still on its
  // way lands nowhere instead of in the conversation that replaced it.
  const turn = useRef(0);
  /** The same id, for highlighting the open chat in the list. */
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TutorChatSummary[] | null>(null);
  /** The words on screen when the panel was last opened. */
  const [screen, setScreen] = useState<string | null>(null);
  /** The screenshot taken on opening, so opening again replaces it rather than piling up. */
  const [autoShot, setAutoShot] = useState<string | null>(null);

  /**
   * Taken before the panel slides in, so the picture is the page and not the
   * panel covering it.
   */
  async function snapshot() {
    if (screenText) {
      try {
        setScreen(screenText().trim() || null);
      } catch {
        setScreen(null);
      }
    }

    const capture = captureScreen ? window.studyApp?.tutor?.captureScreen : undefined;
    if (!capture) return;

    const [shot, info] = await Promise.all([
      capture().catch(() => null),
      model ? Promise.resolve(model) : tutorProviderAction().catch(() => null),
    ]);
    if (info && !model) setModel(info);
    if (!shot || !info?.vision) return;

    setAutoShot(shot);
    setImages((current) => [...current.filter((image) => image !== autoShot), shot]);
  }

  async function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    await snapshot();
    setOpen(true);
  }

  useEffect(() => {
    if (!open || model) return;
    void tutorProviderAction().then(setModel);
  }, [open, model]);

  // New lines scroll the conversation, never the page around it.
  useEffect(() => {
    const node = log.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function loadHistory() {
    try {
      setHistory(await listTutorChats(examId));
    } catch {
      setHistory([]);
    }
  }

  function startNewChat() {
    turn.current += 1;
    setBusy(false);
    chatId.current = null;
    setActiveChat(null);
    setMessages([]);
    setShowHistory(false);
    input.current?.focus();
  }

  async function openChat(id: string) {
    const chat = await getTutorChat(examId, id);
    if (!chat) {
      toast.error("That chat could not be found.");
      void loadHistory();
      return;
    }
    turn.current += 1;
    setBusy(false);
    chatId.current = chat.id;
    setActiveChat(chat.id);
    setMessages(
      chat.messages.map((turn) => ({
        role: turn.role,
        text: turn.text,
        beyondMaterial: turn.beyondMaterial,
        imageCount: turn.imageCount,
      })),
    );
    setShowHistory(false);
    input.current?.focus();
  }

  async function removeChat(id: string) {
    await deleteTutorChat(examId, id);
    if (chatId.current === id) {
      chatId.current = null;
      setActiveChat(null);
    }
    setHistory((current) => current?.filter((chat) => chat.id !== id) ?? null);
  }

  /** Kept on this computer only; images are left out so the database stays small. */
  async function persist(transcript: Message[]) {
    try {
      chatId.current = await saveTutorChat({
        examId,
        id: chatId.current,
        messages: transcript.map((message) => ({
          role: message.role,
          text: message.text,
          imageCount: (message.images?.length ?? 0) + (message.imageCount ?? 0) || undefined,
          beyondMaterial: message.beyondMaterial,
        })),
      });
      setActiveChat(chatId.current);
      setHistory(null);
    } catch {
      // Saving is a convenience; a failed save must never cost the answer.
    }
  }

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

  const context = {
    examId,
    // Sent on every request, so a follow-up still has the page in view.
    slideId: sendSlide ? slideId : null,
    focus: [
      focus,
      screen
        ? `When they opened the tutor, this was the text on their screen:\n"""\n${screen}\n"""\nIf they say "this", "that" or "what does this mean" without naming anything, they mean what is on screen${autoShot ? " (a screenshot of it is attached to their first question)" : ""}. Answer about that, and don't ask them which topic.`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n") || null,
    primerSectionId,
  };

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
    const mine = ++turn.current;

    try {
      const result = await askTutorAction({
        ...context,
        messages: history.map(({ role, text, images }) => ({ role, text, images })),
      });
      if (turn.current !== mine) return;

      if (!result.ok) {
        toast.error(result.error);
        // The question stays in the transcript: it was asked, and retyping it
        // after a failed request is a waste of the student's time.
        return;
      }

      const answered: Message[] = [
        ...history,
        {
          role: "model",
          text: result.reply,
          beyondMaterial: result.beyondMaterial,
          suggestions: result.suggestions,
        },
      ];
      setMessages(answered);
      void persist(answered);
    } finally {
      if (turn.current === mine) {
        setBusy(false);
        input.current?.focus({ preventScroll: true });
      }
    }
  }

  async function makeCards(instruction?: string) {
    setExtracting(true);
    try {
      const result = await extractCardsAction({
        ...context,
        messages: messages.map(({ role, text, images }) => ({ role, text, images })),
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

  const button = trigger ?? (
    <Button variant="outline" size="sm">
      <MessageCircleQuestion className="size-4" />
      Ask the tutor
    </Button>
  );
  const toggle = isValidElement(button)
    ? cloneElement(Children.only(button), {
        onClick: () => void toggleOpen(),
        "aria-expanded": open,
      } as never)
    : button;

  return (
    <>
      {toggle}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className={cn("w-full gap-0 p-0 sm:max-w-xl", className)}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <SheetHeader className="border-b px-5 py-4 pr-12">
            <SheetTitle className="flex flex-wrap items-center gap-2">
              AI study tutor
              {model ? <Badge variant="secondary">{model.model ?? model.name}</Badge> : null}
              {model && !model.vision ? <Badge variant="outline">text only</Badge> : null}
            </SheetTitle>
            <SheetDescription>
              {model?.error
                ? model.error
                : contextLabel
                  ? contextLabel
                  : slideLabel && sendSlide
                    ? `It has your whole deck and flashcards, and is looking at ${slideLabel}.`
                    : "It has your whole deck and your flashcards (ask about “flashcard 12”)."}
            </SheetDescription>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant={showHistory ? "secondary" : "outline"}
                size="sm"
                onClick={() => {
                  const next = !showHistory;
                  setShowHistory(next);
                  if (next) void loadHistory();
                }}
              >
                <History className="size-3.5" />
                Past chats
              </Button>
              {messages.length > 0 || showHistory ? (
                <Button variant="outline" size="sm" onClick={startNewChat}>
                  <RotateCcw className="size-3.5" />
                  New chat
                </Button>
              ) : null}
            </div>
          </SheetHeader>

          {showHistory ? (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {history === null ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Loading…
                </p>
              ) : history.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No saved chats for this deck yet. Every conversation is saved on this computer
                  as you go.
                </p>
              ) : (
                history.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      "hover:bg-muted/60 flex items-center gap-2 rounded-md border p-2",
                      chat.id === activeChat && "border-primary",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void openChat(chat.id)}
                    >
                      <span className="block truncate text-sm font-medium">{chat.title}</span>
                      <span className="text-muted-foreground block text-xs">
                        {formatWhen(chat.updatedAt)} · {Math.ceil(chat.turns / 2)} question
                        {chat.turns > 2 ? "s" : ""}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete "${chat.title}"`}
                      onClick={() => void removeChat(chat.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div ref={log} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {messages.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-sm">
                    {slideLabel && sendSlide
                      ? `${slideLabel} goes with every question.`
                      : "Ask anything about your material, or attach a screenshot."}
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
                      ? "bg-muted ml-auto w-fit max-w-[85%] rounded-lg px-3 py-2"
                      : "min-w-0 rounded-lg border px-4 py-3"
                  }
                >
                  {message.role === "user" ? (
                    <p className="text-sm break-words whitespace-pre-wrap">{message.text}</p>
                  ) : (
                    <div className="min-w-0 overflow-x-auto break-words">
                      <Markdown>{message.text}</Markdown>
                    </div>
                  )}

                  {message.images?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.images.map((image, index) => (
                        // A data URL the student just attached: nothing to optimise
                        // and no remote to fetch.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={index} src={image} alt="" className="h-16 rounded border" />
                      ))}
                    </div>
                  ) : message.imageCount ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {message.imageCount} image{message.imageCount === 1 ? "" : "s"} (not saved)
                    </p>
                  ) : null}

                  {message.beyondMaterial ? (
                    <Badge variant="outline" className="mt-2">
                      Goes beyond your material
                    </Badge>
                  ) : null}

                  {message.role === "model" && i === messages.length - 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 -ml-2"
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
                  ) : null}
                </div>
              ))}

              {busy ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Thinking…
                </p>
              ) : null}

              {suggestions.length > 0 && !busy ? (
                <div className="flex flex-col items-start gap-2">
                  {suggestions.map((suggestion) => (
                    <Button
                      key={suggestion}
                      variant="outline"
                      size="sm"
                      className="h-auto max-w-full justify-start py-1.5 text-left text-xs whitespace-normal"
                      onClick={() => void send(suggestion)}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          <div className="bg-background space-y-2 border-t px-5 py-4">
            {images.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {images.map((image, i) => (
                  <div key={i} className="relative">
                    {/* A local data URL, not a remote asset. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image}
                      alt={image === autoShot ? "Your screen" : ""}
                      title={image === autoShot ? "Your screen, taken as the tutor opened" : undefined}
                      className="h-14 rounded border"
                    />
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
              ref={input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length > 0) void attach(files);
              }}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter is a newline, as everywhere else.
                // Kept from the page too, so a study shortcut does not fire.
                if (event.key !== "Escape") event.stopPropagation();
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (showHistory) setShowHistory(false);
                  void send(draft);
                }
              }}
              placeholder={
                slideId && sendSlide
                  ? "Ask about this page…"
                  : "Ask a question, or paste a screenshot…"
              }
              rows={3}
              className="max-h-40 min-h-20 resize-none"
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
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
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
                onClick={() => {
                  if (showHistory) setShowHistory(false);
                  void send(draft);
                }}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <CardConfirm
        examId={examId}
        slideId={sendSlide ? slideId : null}
        cards={drafts}
        onClose={(saved) => {
          setDrafts(null);
          if (saved) router.refresh();
        }}
      />
    </>
  );
}

function formatWhen(stamp: string) {
  // Older rows carry SQLite's "YYYY-MM-DD HH:MM:SS" in UTC.
  const date = new Date(stamp.includes("T") ? stamp : `${stamp.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

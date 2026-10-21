/**
 * The sample deck bundled with the app: "Intro to Psychology: Memory".
 *
 * It lets a new student try every study mode before setting up a key. Every
 * card carries a rubric (so typed answers can be marked by the keyword grader)
 * and three wrong answers in the answer's own form (so a practice paper's
 * multiple-choice options can be built without a model). The guide has the
 * same topics, a common mistake for each concept, and two exam-style
 * questions at the end.
 *
 * Written for this app; facts are standard introductory-psychology material.
 */
import type { DeckCard, DeckSnapshot } from "@/lib/decks/insert";

export const SAMPLE_DECK_TITLE = "Intro to Psychology: Memory";
export const SAMPLE_COURSE = "Sample deck";
/** The guide's `model`, so the sample deck can be found again. */
export const SAMPLE_ORIGIN = "sample:memory:v1";

type Row = [
  question: string,
  answer: string,
  explanation: string,
  essentialPoints: string[],
  misconceptions: [string, string, string],
  cardType?: string,
];

function topic(name: string, rows: Row[]): DeckCard[] {
  return rows.map(([question, directAnswer, fullExplanation, essentialPoints, misconceptions, cardType]) => ({
    topic: name,
    question,
    directAnswer,
    fullExplanation,
    cardType: cardType ?? "atomic",
    sourceExcerpt: null,
    essentialPoints,
    misconceptions,
  }));
}

const CARDS: DeckCard[] = [
  ...topic("How memory is organized", [
    [
      "What are the three basic processes of memory?",
      "Encoding, storage and retrieval.",
      "Encoding gets information into memory, storage keeps it over time, and retrieval brings it back out when it is needed.",
      ["encoding", "storage", "retrieval"],
      ["Attention, rehearsal and recall.", "Sensing, perceiving and forgetting.", "Input, consolidation and decay."],
    ],
    [
      "What does the Atkinson–Shiffrin (multi-store) model propose?",
      "Information passes from sensory memory to short-term memory to long-term memory.",
      "The 1968 model describes memory as three stores in sequence. Attention moves information from sensory memory into short-term memory, and rehearsal moves it into long-term memory.",
      ["sensory memory", "short-term memory", "long-term memory"],
      [
        "Information is stored once, in a single store, and only its strength changes.",
        "Long-term memory is filled first and then copied into short-term memory.",
        "Memory has two stores: conscious and unconscious.",
      ],
      "process",
    ],
    [
      "In the multi-store model, what moves information from sensory memory into short-term memory?",
      "Attention.",
      "Only what we attend to leaves sensory memory; the rest fades within a second or two.",
      ["attention"],
      ["Rehearsal.", "Sleep.", "Retrieval."],
    ],
    [
      "In the multi-store model, what moves information from short-term into long-term memory?",
      "Rehearsal, especially elaborative rehearsal.",
      "Repeating information keeps it active; linking it to meaning (elaborative rehearsal) is what makes it last.",
      ["rehearsal"],
      ["Attention alone.", "Sensory registration.", "Interference."],
    ],
    [
      "What is the levels-of-processing idea (Craik & Lockhart)?",
      "The deeper (more meaningful) the processing, the better the memory.",
      "Processing a word's meaning leads to better recall than processing how it looks or sounds. Depth, not time spent, predicts memory.",
      ["deeper", "meaning", "better recall"],
      [
        "The longer you look at something, the better you remember it.",
        "Information is processed in three fixed levels, one after another.",
        "Visual processing leads to the strongest memories.",
      ],
    ],
  ]),
  ...topic("Sensory and short-term memory", [
    [
      "What is iconic memory, and how long does it last?",
      "Visual sensory memory; it lasts about a quarter to half a second.",
      "Sperling's partial-report experiments showed people briefly hold nearly a whole visual display, but it fades in under a second.",
      ["visual", "sensory", "under a second"],
      ["Auditory sensory memory; about 3–4 seconds.", "Short-term visual memory; about 20 seconds.", "Photographic long-term memory; years."],
    ],
    [
      "What is echoic memory, and how long does it last?",
      "Auditory sensory memory; it lasts about 3–4 seconds.",
      "It is why you can 'replay' the last few words someone said when you weren't quite listening.",
      ["auditory", "sensory", "seconds"],
      ["Visual sensory memory; under a second.", "Memory for smells; several minutes.", "Long-term memory for songs; years."],
    ],
    [
      "Without rehearsal, about how long does information stay in short-term memory?",
      "About 15–30 seconds.",
      "Peterson and Peterson (1959) found recall of letter strings dropped sharply within 18 seconds when rehearsal was prevented.",
      ["15", "30 seconds"],
      ["About half a second.", "About 10 minutes.", "Indefinitely, until it is replaced."],
    ],
    [
      "What is the classic estimate of short-term memory capacity?",
      "About 7 ± 2 items (Miller, 1956); newer estimates are closer to 4 chunks.",
      "Miller's 'magical number seven' is the classic figure. Later work (Cowan) suggests about four meaningful chunks.",
      ["7", "plus or minus 2"],
      ["About 20 items.", "Unlimited, as long as you pay attention.", "Exactly 3 items."],
    ],
    [
      "What is chunking?",
      "Grouping items into larger meaningful units so more fits in short-term memory.",
      "Remembering 1-9-4-5 as the year 1945 turns four items into one chunk.",
      ["grouping", "meaningful units"],
      [
        "Repeating items over and over to keep them active.",
        "Forgetting older items to make room for new ones.",
        "Storing items as images instead of words.",
      ],
    ],
    [
      "What are the parts of Baddeley's working memory model?",
      "A central executive, a phonological loop, a visuospatial sketchpad and an episodic buffer.",
      "Working memory is short-term memory seen as an active workspace. The central executive directs attention; the loop holds sounds and words; the sketchpad holds images and space; the buffer links them with long-term memory.",
      ["central executive", "phonological loop", "visuospatial sketchpad", "episodic buffer"],
      [
        "Sensory memory, short-term memory and long-term memory.",
        "The id, the ego and the superego.",
        "Encoding, storage and retrieval.",
      ],
      "integration",
    ],
    [
      "Which part of working memory holds words you are repeating to yourself?",
      "The phonological loop.",
      "It holds speech-based information and is what you use when you repeat a phone number under your breath.",
      ["phonological loop"],
      ["The visuospatial sketchpad.", "The central executive.", "The episodic buffer."],
    ],
  ]),
  ...topic("Encoding", [
    [
      "What is the difference between maintenance and elaborative rehearsal?",
      "Maintenance rehearsal repeats information; elaborative rehearsal links it to meaning and what you already know.",
      "Maintenance rehearsal keeps something in short-term memory. Elaborative rehearsal is far better for getting it into long-term memory.",
      ["repeat", "meaning", "elaborative"],
      [
        "Maintenance rehearsal is for long-term memory; elaborative rehearsal is for short-term memory.",
        "They are the same thing with different names.",
        "Elaborative rehearsal repeats information more times than maintenance rehearsal.",
      ],
    ],
    [
      "What is the self-reference effect?",
      "Information related to yourself is remembered better.",
      "Asking 'does this word describe me?' leads to better recall than judging the word's meaning alone.",
      ["yourself", "remembered better"],
      [
        "People remember others' experiences as if they were their own.",
        "People forget information that threatens their self-image.",
        "You remember things better when you say them out loud.",
      ],
    ],
    [
      "What is the spacing effect?",
      "Study spread out over time is remembered better than the same study crammed into one session.",
      "Also called distributed practice. It is why spaced repetition apps schedule reviews days apart.",
      ["spread out", "better than cramming"],
      [
        "Leaving blank space on a page helps you remember it.",
        "Cramming the night before produces the longest-lasting memories.",
        "Memories fade evenly with time, however you study.",
      ],
    ],
    [
      "What is the testing effect (retrieval practice)?",
      "Practicing recall strengthens memory more than rereading.",
      "Each successful retrieval makes the memory easier to retrieve again, which is why flashcards beat highlighting.",
      ["recall", "more than rereading"],
      [
        "Being tested makes people anxious, so they remember less.",
        "Rereading notes is the most effective way to study.",
        "Only tests with feedback improve memory.",
      ],
    ],
    [
      "What is the serial position effect?",
      "Items at the start (primacy) and end (recency) of a list are recalled best.",
      "Early items get more rehearsal and reach long-term memory; the last items are still in short-term memory.",
      ["primacy", "recency"],
      [
        "Items in the middle of a list are recalled best.",
        "Only the last item in a list is remembered.",
        "Items are recalled in the order they were learned.",
      ],
    ],
    [
      "Why are the first items of a list remembered well (the primacy effect)?",
      "They were rehearsed more and reached long-term memory.",
      "The recency effect, by contrast, comes from the last items still being in short-term memory.",
      ["rehearsed more", "long-term memory"],
      [
        "They are still in short-term memory.",
        "They are stored in sensory memory.",
        "They were encoded visually rather than by sound.",
      ],
    ],
    [
      "What are mnemonics? Give one example.",
      "Memory aids that add structure or imagery, such as the method of loci or acronyms.",
      "The method of loci places items along a familiar route; acronyms such as ROY G. BIV compress a list into one cue.",
      ["memory aids", "method of loci"],
      [
        "Medicines that improve memory, such as caffeine.",
        "Brain regions that store memories, such as the hippocampus.",
        "Types of amnesia, such as retrograde amnesia.",
      ],
    ],
  ]),
  ...topic("Long-term memory", [
    [
      "What is the difference between explicit and implicit memory?",
      "Explicit memory is consciously recalled; implicit memory shows in behavior without conscious recall.",
      "Explicit (declarative) memory covers facts and events. Implicit (nondeclarative) memory covers skills, habits, priming and conditioning.",
      ["conscious", "without awareness"],
      [
        "Explicit memory is short-term; implicit memory is long-term.",
        "Explicit memory is for words; implicit memory is for pictures.",
        "Explicit memory is accurate; implicit memory is always false.",
      ],
    ],
    [
      "What is episodic memory?",
      "Memory for personal experiences tied to a time and place.",
      "Remembering your last birthday dinner is episodic memory. It is a kind of explicit memory.",
      ["personal experiences", "time and place"],
      ["Memory for general facts and word meanings.", "Memory for how to perform skills.", "Memory held for under 30 seconds."],
    ],
    [
      "What is semantic memory?",
      "Memory for general knowledge and facts, not tied to when you learned them.",
      "Knowing that Paris is the capital of France is semantic memory.",
      ["general knowledge", "facts"],
      ["Memory for personal experiences.", "Memory for motor skills.", "Memory for sounds you just heard."],
    ],
    [
      "What is procedural memory?",
      "Implicit memory for skills and habits, such as riding a bike.",
      "It is shown by doing rather than by describing, and it often survives damage that wipes out explicit memory.",
      ["skills", "implicit"],
      ["Memory for facts.", "Memory for events in your life.", "Memory for the order of a list."],
    ],
    [
      "What is priming?",
      "Earlier exposure to a stimulus influences a later response without conscious awareness.",
      "Seeing the word 'yellow' makes you faster to recognize 'banana'. It is a form of implicit memory.",
      ["earlier exposure", "without awareness"],
      [
        "Deliberately rehearsing information before a test.",
        "Recalling the first items in a list best.",
        "Preparing the brain for sleep so memories consolidate.",
      ],
    ],
    [
      "What is a schema, and how does it affect memory?",
      "An organized framework of knowledge that shapes what we encode and how we reconstruct memories.",
      "Schemas help us remember what fits them and lead us to fill in details that 'should' have been there, as in Bartlett's 'War of the Ghosts' study.",
      ["framework", "reconstruct"],
      [
        "A memory stored exactly as it happened.",
        "A type of sensory memory for images.",
        "A brain region that stores procedures.",
      ],
    ],
  ]),
  ...topic("Retrieval", [
    [
      "What is the difference between recall and recognition?",
      "Recall retrieves information with few cues; recognition identifies it among options.",
      "An essay question tests recall; a multiple-choice question tests recognition, which is usually easier.",
      ["recall", "recognition", "cues"],
      [
        "Recall is for facts; recognition is for faces only.",
        "Recognition is harder than recall because there are more options.",
        "They are two names for the same process.",
      ],
    ],
    [
      "What is encoding specificity?",
      "Memory is best when the cues at retrieval match the conditions at encoding.",
      "This principle (Tulving) explains both context-dependent and state-dependent memory.",
      ["retrieval cues", "match", "encoding"],
      [
        "Every memory is stored in one specific brain cell.",
        "Only specific details are encoded; general ideas are lost.",
        "Memories must be retrieved in the order they were encoded.",
      ],
    ],
    [
      "What is context-dependent memory? Give the classic example.",
      "Recall is better in the same environment where learning happened — divers recalled words better in the setting where they learned them.",
      "Godden and Baddeley (1975) had divers learn words on land or underwater; recall was best when the setting matched.",
      ["same environment", "divers"],
      [
        "Memory depends on your mood, not your surroundings.",
        "Memories formed in unusual places are always forgotten.",
        "Context only matters for procedural memory.",
      ],
    ],
    [
      "What is state-dependent memory?",
      "Recall is better when your internal state (mood, alertness, etc.) matches the state during learning.",
      "Mood-congruent memory is a related idea: in a bad mood, bad memories come to mind more easily.",
      ["internal state", "matches"],
      [
        "Recall is better in the same physical room as learning.",
        "Memory depends on which state or country you live in.",
        "Recall is always worse when you are tired.",
      ],
    ],
    [
      "What is the tip-of-the-tongue phenomenon?",
      "Feeling sure you know something but being temporarily unable to retrieve it.",
      "People can often recall the first letter or number of syllables, showing the memory is stored but the retrieval route is blocked.",
      ["know", "unable to retrieve"],
      [
        "Saying something before you've thought it through.",
        "Remembering a taste better than a word.",
        "Permanently losing a word from memory.",
      ],
    ],
  ]),
  ...topic("Forgetting", [
    [
      "What does Ebbinghaus's forgetting curve show?",
      "Most forgetting happens soon after learning, then the rate of loss levels off.",
      "Ebbinghaus tested himself on nonsense syllables and found a steep early drop followed by a slow decline.",
      ["fast at first", "levels off"],
      [
        "Forgetting happens at a steady rate over time.",
        "We forget nothing for a week, then forget everything.",
        "Memories get stronger the longer you leave them.",
      ],
    ],
    [
      "What is proactive interference?",
      "Old learning disrupts recall of new information.",
      "Writing last year's date in January is proactive interference: the old memory acts forward.",
      ["old", "disrupts new"],
      [
        "New learning disrupts recall of old information.",
        "Forgetting caused by brain injury.",
        "Forgetting because a memory was never encoded.",
      ],
    ],
    [
      "What is retroactive interference?",
      "New learning disrupts recall of old information.",
      "After learning Spanish, your high-school French vocabulary may be harder to recall: the new memory acts backward.",
      ["new", "disrupts old"],
      [
        "Old learning disrupts recall of new information.",
        "Forgetting events before a brain injury.",
        "Forgetting that happens only in old age.",
      ],
    ],
    [
      "What is encoding failure?",
      "Information is never stored in long-term memory in the first place, so it cannot be recalled.",
      "Most people can't draw a penny accurately: they never attended to its details, so there is nothing to retrieve.",
      ["never stored"],
      [
        "A memory that was stored but has faded over time.",
        "A memory blocked by a newer memory.",
        "A memory pushed out of awareness because it is painful.",
      ],
    ],
    [
      "What is the difference between retrograde and anterograde amnesia?",
      "Retrograde amnesia loses memories from before the injury; anterograde amnesia can't form new memories after it.",
      "Patient H.M. had severe anterograde amnesia after his hippocampi were removed, yet he could still learn new motor skills.",
      ["retrograde", "before", "anterograde", "new memories"],
      [
        "Retrograde amnesia can't form new memories; anterograde loses old ones.",
        "Retrograde amnesia is temporary; anterograde amnesia is permanent.",
        "Both mean losing all memory of who you are.",
      ],
    ],
  ]),
  ...topic("Memory errors", [
    [
      "What is the misinformation effect?",
      "Misleading information after an event distorts the memory of it.",
      "Loftus and Palmer (1974): people asked how fast cars 'smashed' gave higher speed estimates, and more 'remembered' broken glass, than those asked about cars that 'hit'.",
      ["misleading information", "after the event"],
      [
        "Forgetting information you were told was false.",
        "Remembering only the most recent version of an event.",
        "Deliberately lying about what you remember.",
      ],
    ],
    [
      "What is source amnesia (source misattribution)?",
      "Remembering information but forgetting where you learned it.",
      "You may 'remember' an event you only heard about or saw in a photo, believing you experienced it.",
      ["forget where", "learned it"],
      [
        "Forgetting a source of information was false.",
        "Forgetting the content but remembering the source.",
        "Amnesia caused by damage to one specific brain area.",
      ],
    ],
    [
      "Why are flashbulb memories not as reliable as they feel?",
      "They are vivid and held with confidence, but they change over time like other memories.",
      "Studies after the 9/11 attacks found people's accounts changed a lot over the following years while their confidence stayed high.",
      ["vivid", "confident", "change over time"],
      [
        "Because they are stored in sensory memory and fade within seconds.",
        "Because emotional events are never encoded.",
        "They are reliable: emotional memories are recorded exactly.",
      ],
    ],
    [
      "What does it mean that memory is reconstructive?",
      "Recall rebuilds a memory from stored pieces plus expectations, so it can change each time.",
      "Memory is not a recording. Each retrieval can add, drop or reshape details, especially to fit our schemas.",
      ["rebuilt", "not a recording"],
      [
        "Every memory is a perfect recording of what happened.",
        "Damaged memories can be rebuilt with practice.",
        "Memories are only stored once they have been reconstructed in sleep.",
      ],
    ],
  ]),
  ...topic("The biology of memory", [
    [
      "What role does the hippocampus play in memory?",
      "It is vital for forming new explicit memories and consolidating them into long-term storage.",
      "Damage to the hippocampus (as in patient H.M.) prevents forming new explicit memories but leaves old memories and new skills largely intact.",
      ["new explicit memories", "consolidation"],
      [
        "It stores procedural skills such as riding a bike.",
        "It processes fear and emotional memories only.",
        "It holds sensory memory for less than a second.",
      ],
    ],
    [
      "Which brain structure is most involved in procedural memory and classical conditioning of movements?",
      "The cerebellum (with the basal ganglia for habits).",
      "People with hippocampal damage can still learn motor skills, because the cerebellum and basal ganglia are intact.",
      ["cerebellum"],
      ["The hippocampus.", "The amygdala.", "The occipital lobe."],
    ],
    [
      "How does the amygdala affect memory?",
      "It strengthens memories of emotionally arousing events.",
      "Stress hormones and amygdala activity during an emotional event boost how strongly it is encoded.",
      ["emotion", "strengthens"],
      [
        "It stores all long-term memories.",
        "It erases traumatic memories.",
        "It controls short-term memory span.",
      ],
    ],
    [
      "What is long-term potentiation (LTP)?",
      "A lasting increase in the strength of signaling between neurons after repeated stimulation.",
      "LTP is thought to be a cellular basis of learning and memory: neurons that fire together, wire together.",
      ["stronger connections", "repeated stimulation"],
      [
        "The gradual loss of neurons with age.",
        "A rise in blood flow to the brain during study.",
        "The time it takes for a memory to reach long-term storage.",
      ],
    ],
    [
      "Why does sleep help memory?",
      "During sleep the brain replays and consolidates the day's memories.",
      "Deep sleep helps consolidate explicit memories; studying and then sleeping beats pulling an all-nighter.",
      ["consolidates", "sleep"],
      [
        "Sleep erases short-term memory to free up space.",
        "Sleep has no effect on memory, only on mood.",
        "New information can be learned while asleep.",
      ],
    ],
  ]),
];

const GUIDE: DeckSnapshot["guide"] = {
  overview:
    "Memory is how we encode, store and retrieve information. This guide follows a memory from the moment you notice something to the moment you recall it — and the ways it can go wrong.",
  topics: [
    {
      title: "How memory is organized",
      intro: "Two classic models describe memory as stores and as levels of processing.",
      sections: [
        {
          conceptName: "The multi-store model",
          definition: [
            "Atkinson and Shiffrin (1968) proposed three stores: sensory memory, short-term memory and long-term memory.",
          ],
          breakdown: [
            "Attention moves information from sensory memory into short-term memory.",
            "Rehearsal moves it from short-term into long-term memory.",
            "Information that isn't attended to or rehearsed is lost.",
          ],
          example: [
            "You glance at a poster (sensory), read the event date (attention), and repeat it until you write it in your planner (rehearsal).",
          ],
          misconception: {
            misconception: "Repeating something over and over is the best way to get it into long-term memory.",
            incorrectApplication: "A student reads the same definition ten times the night before the exam.",
            whyFlawed:
              "Plain repetition (maintenance rehearsal) mostly keeps information active. Linking it to meaning (elaborative rehearsal) and spacing practice out work far better.",
          },
        },
        {
          conceptName: "Levels of processing",
          definition: ["Craik and Lockhart (1972) argued that deeper, more meaningful processing produces more durable memories."],
          breakdown: [
            "Shallow processing attends to how a word looks or sounds.",
            "Deep processing attends to what it means and how it connects to what you know.",
          ],
          example: ["Explaining a concept in your own words beats copying it out word for word."],
          misconception: null,
        },
      ],
    },
    {
      title: "Sensory and working memory",
      intro: "Short-lived stores that hold what we're dealing with right now.",
      sections: [
        {
          conceptName: "Sensory memory",
          definition: ["A very brief store of raw sensory input: iconic (visual, under a second) and echoic (auditory, a few seconds)."],
          breakdown: ["Sperling's partial-report studies showed we briefly hold almost a whole visual scene."],
          example: ["Replaying the last words someone said when you weren't quite listening uses echoic memory."],
          misconception: null,
        },
        {
          conceptName: "Short-term and working memory",
          definition: [
            "Short-term memory holds about 7 ± 2 items (or about 4 chunks) for 15–30 seconds without rehearsal.",
          ],
          breakdown: [
            "Chunking groups items into meaningful units so more fits.",
            "Baddeley's working memory model splits it into a central executive, phonological loop, visuospatial sketchpad and episodic buffer.",
          ],
          example: ["A phone number is easier to hold as 555-0142 than as seven separate digits."],
          misconception: {
            misconception: "Short-term memory is just long-term memory that hasn't lasted long.",
            incorrectApplication: "Assuming that holding a number in your head for a minute means you've learned it.",
            whyFlawed:
              "Short-term memory is a separate, limited workspace. Without elaborative rehearsal, what it holds is gone within seconds.",
          },
        },
      ],
    },
    {
      title: "Encoding and long-term memory",
      intro: "How information gets stored for the long run, and the kinds of long-term memory.",
      sections: [
        {
          conceptName: "Effective encoding",
          definition: ["Encoding is getting information into memory; how you encode decides how well you remember."],
          breakdown: [
            "The spacing effect: spread study over days rather than cramming.",
            "The testing effect: practicing recall beats rereading.",
            "The self-reference effect: relating material to yourself makes it stick.",
          ],
          example: ["Three 20-minute flashcard sessions across a week beat one hour the night before."],
          misconception: {
            misconception: "If notes feel familiar when you reread them, you know the material.",
            incorrectApplication: "A student rereads highlighted notes until they feel easy and stops studying.",
            whyFlawed:
              "Familiarity is recognition, not recall. The exam asks you to retrieve the answer, so practice retrieving it.",
          },
        },
        {
          conceptName: "Types of long-term memory",
          definition: [
            "Explicit (declarative) memory is consciously recalled; implicit (nondeclarative) memory shows in behavior.",
          ],
          breakdown: [
            "Explicit: episodic (personal events) and semantic (facts).",
            "Implicit: procedural (skills), priming and conditioning.",
          ],
          example: ["Remembering your first day of college is episodic; knowing what a neuron is is semantic; typing is procedural."],
          misconception: null,
        },
      ],
    },
    {
      title: "Retrieval and forgetting",
      intro: "Getting memories back out, and why we sometimes can't.",
      sections: [
        {
          conceptName: "Retrieval cues",
          definition: ["Encoding specificity: recall is best when retrieval cues match the conditions at encoding."],
          breakdown: [
            "Context-dependent memory: the same place helps (Godden and Baddeley's divers).",
            "State-dependent memory: the same internal state helps.",
            "Recognition is usually easier than recall because the answer itself is a cue.",
          ],
          example: ["Walking back into the kitchen to remember what you came for."],
          misconception: null,
        },
        {
          conceptName: "Why we forget",
          definition: ["Forgetting can come from encoding failure, decay, interference or retrieval failure."],
          breakdown: [
            "Ebbinghaus's forgetting curve: most loss happens soon after learning.",
            "Proactive interference: old learning blocks new.",
            "Retroactive interference: new learning blocks old.",
          ],
          example: ["Writing last year's date in January is proactive interference."],
          misconception: {
            misconception: "Proactive interference means new learning makes you forget old things.",
            incorrectApplication: "Calling 'forgetting French after learning Spanish' proactive interference.",
            whyFlawed:
              "That's retroactive: the new memory acts backward. Proactive interference is the old memory acting forward on the new one.",
          },
        },
      ],
    },
    {
      title: "Memory errors and the brain",
      intro: "Memory is reconstructed, not replayed — and different brain areas handle different kinds.",
      sections: [
        {
          conceptName: "Reconstructive memory",
          definition: ["Recall rebuilds a memory from stored pieces and expectations, so it can change each time."],
          breakdown: [
            "The misinformation effect: misleading information after an event alters the memory (Loftus and Palmer).",
            "Source amnesia: remembering a fact but not where it came from.",
            "Flashbulb memories feel vivid and certain but still change.",
          ],
          example: ["Witnesses asked how fast cars 'smashed' later remembered broken glass that wasn't there."],
          misconception: {
            misconception: "A vivid, confident memory must be accurate.",
            incorrectApplication: "Trusting an eyewitness because they are completely sure.",
            whyFlawed: "Confidence and vividness don't track accuracy; flashbulb memories drift while confidence stays high.",
          },
        },
        {
          conceptName: "Memory in the brain",
          definition: ["Different structures support different kinds of memory."],
          breakdown: [
            "Hippocampus: forming new explicit memories and consolidating them.",
            "Cerebellum and basal ganglia: procedural memory.",
            "Amygdala: strengthening emotional memories.",
            "Long-term potentiation: connections between neurons strengthen with repeated use.",
          ],
          example: ["Patient H.M. could not form new explicit memories after hippocampal surgery but still learned mirror drawing."],
          misconception: null,
        },
      ],
    },
    {
      title: "Practice exam questions",
      intro: "Two questions in the style of an intro psych exam. Try them before reading the answers.",
      sections: [
        {
          conceptName:
            "Question 1: Maya studies Spanish this semester and now struggles to recall the French she learned in high school. Which kind of forgetting is this?",
          definition: ["Answer: retroactive interference."],
          breakdown: [
            "New learning (Spanish) is interfering with older learning (French), so the interference acts backward in time.",
            "Proactive interference would be the reverse: French making it harder to learn Spanish.",
          ],
          example: ["Wrong options often include proactive interference, encoding failure and decay — eliminate them by asking which memory is old and which is new."],
          misconception: null,
        },
        {
          conceptName:
            "Question 2: A student studies in the library and takes the exam in the same library. Their good recall is best explained by what principle?",
          definition: ["Answer: encoding specificity, in the form of context-dependent memory."],
          breakdown: [
            "Cues in the environment at encoding are present again at retrieval, so they help bring the memory back.",
            "State-dependent memory would involve an internal state, such as mood, rather than a place.",
          ],
          example: ["Godden and Baddeley's divers showed the same effect underwater versus on land."],
          misconception: null,
        },
      ],
    },
  ],
};

export const SAMPLE_DECK: DeckSnapshot = {
  title: SAMPLE_DECK_TITLE,
  course: SAMPLE_COURSE,
  term: null,
  cards: CARDS,
  guide: GUIDE,
  origin: SAMPLE_ORIGIN,
};

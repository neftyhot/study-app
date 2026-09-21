/**
 * Runs the grading regression fixtures against the live grader.
 *
 *   npm run grade:check
 *
 * Kept out of the unit suite on purpose: this measures the model's judgement,
 * needs an API key, and costs money. Our own code paths are covered by
 * src/lib/grade/grade.test.ts with a stubbed provider.
 */
import { GRADING_FIXTURES } from "../src/lib/grade/fixtures";
import { createSemanticGrader } from "../src/lib/grade/semantic";
import {
  createGeminiProvider,
  estimateCost,
  formatCost,
  getProvider,
  type LlmProvider,
  type ThinkingEffort,
} from "../src/lib/llm";

async function main() {
  // GRADE_MODEL and GRADE_THINKING compare settings; tokens are totalled so
  // the comparison has a price as well as a score.
  const base = process.env.GRADE_MODEL
    ? createGeminiProvider({ model: process.env.GRADE_MODEL })
    : getProvider();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const provider: LlmProvider = {
    name: base.name,
    model: base.model,
    async generateStructured(request) {
      const result = await base.generateStructured(request);
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      return result as never;
    },
  };
  const grader = createSemanticGrader(provider, {
    thinking: process.env.GRADE_THINKING as ThinkingEffort | undefined,
  });
  let passed = 0;
  const failures: string[] = [];

  for (const fixture of GRADING_FIXTURES) {
    const grade = await grader.grade({
      question: fixture.question,
      expected: fixture.expected,
      essentialPoints: fixture.essentialPoints,
      misconceptions: fixture.misconceptions,
      answer: fixture.answer,
    });

    const verdictOk = grade.verdict === fixture.verdict;
    const errorOk =
      fixture.errorType === undefined || grade.errorType === fixture.errorType;
    const ok = verdictOk && errorOk;

    if (ok) passed += 1;
    else {
      failures.push(
        `${fixture.name}: expected ${fixture.verdict}${
          fixture.errorType ? `/${fixture.errorType}` : ""
        }, got ${grade.verdict}/${grade.errorType}\n    answer:   ${fixture.answer}\n    feedback: ${grade.feedback}`,
      );
    }

    console.log(
      `${ok ? "PASS" : "FAIL"}  ${fixture.name.padEnd(38)} ${grade.verdict}/${grade.errorType}`,
    );
  }

  console.log(`\n${passed}/${GRADING_FIXTURES.length} fixtures passed`);
  console.log(
    `${usage.inputTokens} in / ${usage.outputTokens} out tokens, ${formatCost(estimateCost(base.model, usage))} on ${base.model} (thinking ${process.env.GRADE_THINKING ?? "default"})`,
  );
  for (const failure of failures) console.log(`\n  ${failure}`);

  process.exitCode = failures.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

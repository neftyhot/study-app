import {
  PRIVACY_POLICY,
  PRIVACY_POLICY_SUMMARY,
  PRIVACY_POLICY_UPDATED,
} from "@/lib/privacy-policy";

const anchor = (i: number) => `privacy-${i + 1}`;

/** The policy text, used by the first-launch gate and the Settings card. */
export function PrivacyPolicyText() {
  return (
    <div className="space-y-6 text-sm">
      <p className="text-muted-foreground text-xs">Last updated {PRIVACY_POLICY_UPDATED}.</p>

      <section aria-labelledby="privacy-summary" className="bg-muted/40 space-y-2 rounded-md border p-4">
        <h3 id="privacy-summary" className="font-semibold">
          In short
        </h3>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 leading-relaxed">
          {PRIVACY_POLICY_SUMMARY.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <nav aria-label="Contents" className="space-y-1.5">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Contents</h3>
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {PRIVACY_POLICY.map((section, i) => (
            <li key={section.heading}>
              <a href={`#${anchor(i)}`} className="hover:underline">
                <span className="text-muted-foreground mr-1.5 tabular-nums">{i + 1}.</span>
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {PRIVACY_POLICY.map((section, i) => (
        <section
          key={section.heading}
          id={anchor(i)}
          className="scroll-mt-4 space-y-2 border-t pt-4"
        >
          <h3 className="font-semibold">
            <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>
            {section.heading}
          </h3>
          {section.intro ? (
            <p className="text-muted-foreground leading-relaxed">{section.intro}</p>
          ) : null}
          {section.items ? (
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 leading-relaxed">
              {section.items.map((item) => (
                <li key={item.text}>
                  {item.label ? (
                    <span className="text-foreground font-medium">{item.label}: </span>
                  ) : null}
                  {item.text}
                </li>
              ))}
            </ul>
          ) : null}
          {section.outro?.map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

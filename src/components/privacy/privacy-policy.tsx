import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED } from "@/lib/privacy-policy";

/** The policy text, used by the first-launch gate and the Settings card. */
export function PrivacyPolicyText() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground text-xs">Last updated {PRIVACY_POLICY_UPDATED}.</p>
      {PRIVACY_POLICY.map((section) => (
        <section key={section.heading} className="space-y-1.5">
          <h3 className="font-medium">{section.heading}</h3>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

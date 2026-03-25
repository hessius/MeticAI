import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type ParsedSection,
  getSectionStyle,
  CIRCLED_NUMBERS,
} from "@/lib/parseAnalysis";

export function SectionCard({ section }: { section: ParsedSection }) {
  const config = getSectionStyle(section.title);

  return (
    <Card className={`${config.borderColor} border-2 overflow-hidden`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <span className={`shrink-0 ${config.color}`}>{config.icon}</span>
          <span className="text-foreground font-semibold">
            {section.title}
          </span>
          {section.assessment && (
            <Badge className={`${section.assessment.color} text-white shrink-0`}>
              {section.assessment.status}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {section.subsections.map((subsection, idx) => (
          <div key={idx} className="space-y-2">
            <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <span
                className={`text-base shrink-0 ${config.color}`}
              >
                {CIRCLED_NUMBERS[idx] || `${idx + 1}.`}
              </span>
              <span className="break-words">{subsection.title}</span>
            </h4>
            <ul className="space-y-1.5 pl-6">
              {subsection.items.map((item, itemIdx) => (
                <li
                  key={itemIdx}
                  className="text-sm text-muted-foreground flex items-start gap-2"
                >
                  <span className="text-primary shrink-0 leading-relaxed">
                    •
                  </span>
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
            {idx < section.subsections.length - 1 && (
              <Separator className="mt-3" />
            )}
          </div>
        ))}

        {section.subsections.length === 0 && (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {section.content}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

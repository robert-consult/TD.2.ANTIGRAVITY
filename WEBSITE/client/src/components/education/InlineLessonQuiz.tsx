import { useState } from "react";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { LessonQuizItem } from "@/lib/educationTypes";

type InlineLessonQuizProps = {
  quizItems: LessonQuizItem[];
};

export function InlineLessonQuiz({ quizItems }: InlineLessonQuizProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const answeredCount = Object.keys(answers).length;
  const correctCount = quizItems.filter(
    (item) => answers[item.id] === item.correctAnswer.label,
  ).length;
  const progress = quizItems.length
    ? Math.round((answeredCount / quizItems.length) * 100)
    : 0;

  return (
    <section className="space-y-5 rounded-3xl border bg-card p-5 md:p-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-primary">
          <CircleHelp className="h-4 w-4" />
          Inline Lesson Quiz
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Check Your Understanding</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each question comes directly from the lesson you just read.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {correctCount}/{quizItems.length} correct
          </div>
        </div>
        <Progress value={progress} className="h-2 bg-muted" />
      </div>

      <div className="space-y-4">
        {quizItems.map((item, index) => {
          const selectedAnswer = answers[item.id];
          const isCorrect = selectedAnswer === item.correctAnswer.label;
          const hasAnswered = Boolean(selectedAnswer);

          return (
            <Card key={item.id} className="border-border bg-background">
              <CardHeader>
                <CardTitle className="text-lg">
                  {index + 1}. {item.prompt}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2">
                  {item.choices.map((choice) => {
                    const isSelected = selectedAnswer === choice.label;
                    const isCorrectChoice = item.correctAnswer.label === choice.label;

                    return (
                      <Button
                        key={`${item.id}-${choice.label}`}
                        type="button"
                        variant="outline"
                        className={cn(
                          "justify-start whitespace-normal text-left h-auto py-3",
                          isSelected && !isCorrect && "border-red-500/40 bg-red-500/10",
                          isSelected && isCorrect && "border-emerald-500/40 bg-emerald-500/10",
                          !isSelected && hasAnswered && isCorrectChoice && "border-emerald-500/30",
                        )}
                        onClick={() =>
                          setAnswers((current) => ({
                            ...current,
                            [item.id]: choice.label,
                          }))
                        }
                      >
                        <span className="mr-2 font-semibold">{choice.label}.</span>
                        <span>{choice.text}</span>
                      </Button>
                    );
                  })}
                </div>

                {hasAnswered ? (
                  <div
                    className={cn(
                      "rounded-2xl border p-4 text-sm",
                      isCorrect
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                        : "border-red-500/30 bg-red-500/10 text-red-100",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {isCorrect ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <div className="space-y-2">
                        <p className="font-semibold">
                          {isCorrect
                            ? "Correct"
                            : `Correct answer: ${item.correctAnswer.label}. ${item.correctAnswer.text}`}
                        </p>
                        <p className="leading-6">{item.explanation}</p>
                        <p className="text-xs uppercase tracking-[0.18em] opacity-80">
                          Lesson anchor: {item.lessonAnchor}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

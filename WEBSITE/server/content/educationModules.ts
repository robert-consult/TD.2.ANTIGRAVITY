export type CourseModule = {
  slug: string;
  title: string;
  description: string;
  category: string;
  level?: "Beginner" | "Intermediate" | "Advanced";
  url?: string;
};

export const educationModules: CourseModule[] = [
  {
    slug: "market-structure-basics",
    title: "Market Structure Basics",
    description:
      "Learn how major asset classes move, how sessions overlap, and how to read the structure behind price action before you place risk.",
    category: "Foundations",
    level: "Beginner",
  },
  {
    slug: "chart-and-platform-workflows",
    title: "Chart And Platform Workflows",
    description:
      "Build clean chart routines, compare symbols quickly, and use TradingView-powered market context without turning your setup into noise.",
    category: "Tools",
    level: "Beginner",
  },
  {
    slug: "risk-and-position-sizing",
    title: "Risk And Position Sizing",
    description:
      "Translate conviction into repeatable size decisions, hard loss limits, and realistic reward targets that protect your downside first.",
    category: "Risk",
    level: "Intermediate",
  },
  {
    slug: "technical-analysis-process",
    title: "Technical Analysis Process",
    description:
      "Use structure, momentum, and confirmation signals as a process, not a bag of indicators, so your setups stay testable and consistent.",
    category: "Analysis",
    level: "Intermediate",
  },
  {
    slug: "macro-and-event-awareness",
    title: "Macro And Event Awareness",
    description:
      "Track catalysts that move indices, currencies, commodities, and equities, then adjust your risk and timing around event volatility.",
    category: "Macro",
    level: "Advanced",
  },
  {
    slug: "performance-review-routine",
    title: "Performance Review Routine",
    description:
      "Review your trades like a risk manager: what worked, what failed, where discipline slipped, and which patterns actually deserve more capital.",
    category: "Psychology",
    level: "Advanced",
  },
];

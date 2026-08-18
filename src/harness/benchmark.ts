// The fixed benchmark set from the brief. Family labels feed the improvement
// packet's per-family statistics.

export interface BenchmarkPrompt {
  n: number;
  prompt: string;
  family: string;
  curveball?: boolean;
}

export const BENCHMARK: BenchmarkPrompt[] = [
  { n: 1, prompt: "Draw a demand and supply diagram.", family: "supply_demand" },
  { n: 2, prompt: "Show why a price ceiling creates a shortage.", family: "supply_demand" },
  { n: 3, prompt: "Show the deadweight loss from a tax, with shaded regions.", family: "supply_demand" },
  { n: 4, prompt: "Draw a decision tree comparing surgery vs. medication with probabilities and QALY payoffs.", family: "decision_tree" },
  { n: 5, prompt: "Draw a Markov model with Healthy, Sick, Dead states.", family: "markov_model" },
  { n: 6, prompt: "Draw a cost-effectiveness plane and mark a dominant intervention.", family: "cost_effectiveness_plane" },
  { n: 7, prompt: "Illustrate diminishing marginal utility.", family: "generic_axes_diagram" },
  { n: 8, prompt: "Draw a 2×2 table for sensitivity and specificity.", family: "two_by_two_table" },
  { n: 9, prompt: "Draw a timeline of a screening program from invitation to diagnosis.", family: "timeline", curveball: true },
  { n: 10, prompt: "Illustrate herd immunity as a network of people.", family: "network", curveball: true },
];

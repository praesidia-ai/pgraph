export interface BudgetOption<T> {
  cost: number;
  utility: number;
  value: T;
}
/** Multiple-choice knapsack: select at most one representation per symbol. */
export function optimizeBudget<T>(
  groups: BudgetOption<T>[][],
  budget: number,
): T[] {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 32000)
    throw new Error("Invalid optimization budget");
  for (const group of groups) {
    if (group.length > 254) throw new Error("Too many representations");
    for (const option of group)
      if (
        !Number.isSafeInteger(option.cost) ||
        option.cost < 1 ||
        !Number.isFinite(option.utility) ||
        option.utility < 0
      )
        throw new Error("Invalid representation cost/utility");
  }
  if (budget <= 0 || !groups.length) return [];
  let previous = new Float64Array(budget + 1);
  const choices: Uint8Array[] = [];
  for (const group of groups) {
    const next = previous.slice();
    const choice = new Uint8Array(budget + 1);
    for (let capacity = 1; capacity <= budget; capacity++)
      for (let i = 0; i < group.length; i++) {
        const option = group[i]!;
        if (option.cost > capacity) continue;
        const score = previous[capacity - option.cost]! + option.utility;
        if (score > next[capacity]! + 1e-9) {
          next[capacity] = score;
          choice[capacity] = i + 1;
        }
      }
    choices.push(choice);
    previous = next;
  }
  const selected: T[] = [];
  let capacity = budget;
  for (let g = groups.length - 1; g >= 0; g--) {
    const index = choices[g]![capacity]!;
    if (index) {
      const option = groups[g]![index - 1]!;
      selected.push(option.value);
      capacity -= option.cost;
    }
  }
  return selected.reverse();
}

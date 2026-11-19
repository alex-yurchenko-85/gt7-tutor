export type Step<T> = { fromM: number; value: T };

export class StepCursor<T> {
  private readonly fromM: number[];
  private readonly values: T[];
  private readonly below: T;
  private index = -1;

  constructor(below: T, steps: Step<T>[]) {
    this.below = below;
    this.fromM = steps.map(step => step.fromM);
    this.values = steps.map(step => step.value);
  }

  at(sM: number): T {
    if (Number.isNaN(sM)) return this.below;
    while (this.index + 1 < this.fromM.length && this.fromM[this.index + 1]! <= sM) this.index += 1;
    while (this.index >= 0 && this.fromM[this.index]! > sM) this.index -= 1;
    return this.index < 0 ? this.below : this.values[this.index]!;
  }
}

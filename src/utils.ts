import { PythonRandom, type ReducedTrialRow } from "psyflow-web";

export interface ConditionGenerationConfig {
  probability_levels?: number[];
  hard_reward_levels?: number[];
  randomize_order?: boolean;
  no_choice_hard_prob?: number;
  enable_logging?: boolean;
}

export interface EefrtOfferSpec {
  offer_probability: number;
  hard_reward: number;
  condition_id: string;
  trial_index: number;
  fallback_choice: "easy" | "hard";
  reward_draw_u: number;
}

function clampProbability(value: unknown, fallback = 0.5): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function parseNumberList(input: unknown, fallback: number[]): number[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...fallback];
  }
  const parsed = input.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return parsed.length > 0 ? parsed : [...fallback];
}

function samplePython<T>(rng: PythonRandom, population: T[], k: number): T[] {
  const n = population.length;
  if (k < 0 || k > n) {
    throw new RangeError("Sample larger than population or is negative.");
  }
  const result = new Array<T>(k);
  let setsize = 21;
  if (k > 5) {
    setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
  }
  if (n <= setsize) {
    const pool = [...population];
    for (let i = 0; i < k; i += 1) {
      const j = rng.randBelow(n - i);
      result[i] = pool[j];
      pool[j] = pool[n - i - 1];
    }
    return result;
  }

  const selected = new Set<number>();
  for (let i = 0; i < k; i += 1) {
    let j = rng.randBelow(n);
    while (selected.has(j)) {
      j = rng.randBelow(n);
    }
    selected.add(j);
    result[i] = population[j];
  }
  return result;
}

export function build_eefrt_offer_conditions(
  n_trials: number,
  _condition_labels: string[],
  config: ConditionGenerationConfig | undefined,
  seed: number
): string[] {
  const nTrials = Math.max(0, Math.trunc(n_trials));
  if (nTrials === 0) {
    return [];
  }
  const cfg = config ?? {};
  const probs = parseNumberList(cfg.probability_levels, [0.12, 0.5, 0.88]);
  const rewards = parseNumberList(cfg.hard_reward_levels, [1.24, 1.68, 2.11, 2.55, 2.99, 3.43, 3.86, 4.3]).map(
    (value) => Number(value.toFixed(2))
  );
  const randomizeOrder = cfg.randomize_order !== false;
  const noChoiceHardProb = clampProbability(cfg.no_choice_hard_prob, 0.5);
  const rng = new PythonRandom(Math.trunc(seed));

  const combos: Array<{ probability: number; hard_reward: number }> = [];
  for (const probability of probs) {
    for (const hardReward of rewards) {
      combos.push({ probability, hard_reward: hardReward });
    }
  }
  if (combos.length === 0) {
    throw new Error("EEfRT condition generation requires non-empty probability and reward grids.");
  }

  const offers: Array<{ probability: number; hard_reward: number }> = [];
  const reps = Math.floor(nTrials / combos.length);
  const rem = nTrials % combos.length;
  for (let rep = 0; rep < reps; rep += 1) {
    offers.push(...combos.map((combo) => ({ ...combo })));
  }
  if (rem > 0) {
    if (rem <= combos.length) {
      offers.push(...samplePython(rng, combos, rem).map((combo) => ({ ...combo })));
    } else {
      for (let i = 0; i < rem; i += 1) {
        offers.push({ ...combos[Math.floor(rng.random() * combos.length)] });
      }
    }
  }
  if (randomizeOrder) {
    rng.shuffle(offers);
  }

  const encoded: string[] = [];
  offers.forEach((offer, index) => {
    const trialIndex = index + 1;
    const probabilityPct = Math.round(offer.probability * 100);
    const conditionId = `p${String(probabilityPct).padStart(2, "0")}_h${offer.hard_reward.toFixed(2)}_t${String(
      trialIndex
    ).padStart(3, "0")}`;
    const spec: EefrtOfferSpec = {
      offer_probability: offer.probability,
      hard_reward: offer.hard_reward,
      condition_id: conditionId,
      trial_index: trialIndex,
      fallback_choice: rng.random() < noChoiceHardProb ? "hard" : "easy",
      reward_draw_u: rng.random()
    };
    encoded.push(JSON.stringify(spec));
  });

  return encoded;
}

export function parse_offer_condition(condition: string): EefrtOfferSpec {
  const parsed = JSON.parse(String(condition)) as Partial<EefrtOfferSpec>;
  const fallback = parsed.fallback_choice === "hard" ? "hard" : "easy";
  return {
    offer_probability: Number(parsed.offer_probability ?? 0.5),
    hard_reward: Number(parsed.hard_reward ?? 2),
    condition_id: String(parsed.condition_id ?? "offer"),
    trial_index: Number(parsed.trial_index ?? 1),
    fallback_choice: fallback,
    reward_draw_u: clampProbability(parsed.reward_draw_u, 0.5)
  };
}

function toMoney(value: number): string {
  return value.toFixed(2);
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function summarizeBlock(rows: ReducedTrialRow[], blockId: string): {
  hard_rate: number;
  completion_rate: number;
  total_reward: string;
} {
  const blockRows = rows.filter((row) => row.block_id === blockId);
  const n = Math.max(1, blockRows.length);
  const hardRate = blockRows.filter((row) => row.choice_option === "hard").length / n;
  const completionRate = blockRows.filter((row) => row.effort_completed === true).length / n;
  const totalReward = blockRows.reduce((sum, row) => sum + Number(row.reward_amount ?? 0), 0);
  return {
    hard_rate: hardRate,
    completion_rate: completionRate,
    total_reward: toMoney(totalReward)
  };
}

export function summarizeOverall(rows: ReducedTrialRow[]): {
  total_reward: string;
  hard_rate: string;
  completion_rate: string;
} {
  const n = Math.max(1, rows.length);
  const hardRate = rows.filter((row) => row.choice_option === "hard").length / n;
  const completionRate = rows.filter((row) => row.effort_completed === true).length / n;
  const totalReward = rows.reduce((sum, row) => sum + Number(row.reward_amount ?? 0), 0);
  return {
    total_reward: toMoney(totalReward),
    hard_rate: toPercent(hardRate),
    completion_rate: toPercent(completionRate)
  };
}

import {
  set_trial_context,
  type StimBank,
  type TaskSettings,
  type TrialBuilder,
  type TrialSnapshot
} from "psyflow-web";

import { parse_offer_condition } from "./utils";

function resolveChoiceKey(
  response: unknown,
  fallbackChoice: "easy" | "hard",
  easyKey: string,
  hardKey: string
): string {
  if (response === easyKey || response === hardKey) {
    return String(response);
  }
  return fallbackChoice === "hard" ? hardKey : easyKey;
}

function resolveChoiceOption(choiceKey: string, hardKey: string): "easy" | "hard" {
  return choiceKey === hardKey ? "hard" : "easy";
}

function choiceLabel(choice: "easy" | "hard", settings: TaskSettings): string {
  const easyLabel = String(settings.easy_choice_label ?? "低努力");
  const hardLabel = String(settings.hard_choice_label ?? "高努力");
  return choice === "hard" ? hardLabel : easyLabel;
}

function countEffortPresses(snapshot: TrialSnapshot): number {
  return Math.max(0, Number(snapshot.units.effort_execution?.response_count ?? 0));
}

function effortCompleted(snapshot: TrialSnapshot, easyPresses: number): boolean {
  return countEffortPresses(snapshot) >= Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
}

export function run_trial(
  trial: TrialBuilder,
  condition: string,
  context: {
    settings: TaskSettings;
    stimBank: StimBank;
    block_id: string;
    block_idx: number;
  }
): TrialBuilder {
  const { settings, stimBank, block_id, block_idx } = context;
  const offer = parse_offer_condition(condition);

  const choiceKeys = ((settings.choice_keys as string[] | undefined) ?? ["f", "j"]).map(String);
  const easyKey = choiceKeys[0] ?? "f";
  const hardKey = choiceKeys[1] ?? "j";
  const effortKey = String(settings.effort_key ?? "space");

  const easyReward = Number(settings.easy_reward ?? 1);
  const easyPresses = Math.max(1, Number(settings.easy_required_presses ?? 30));
  const hardPresses = Math.max(easyPresses, Number(settings.hard_required_presses ?? 100));
  const easyDeadline = Math.max(0.5, Number(settings.easy_time_limit_s ?? 7));
  const hardDeadline = Math.max(0.5, Number(settings.hard_time_limit_s ?? 21));

  const cueDuration = Number(settings.cue_duration ?? 1);
  const choiceDuration = Number(settings.anticipation_duration ?? 5);
  const readyDuration = Number(settings.ready_duration ?? 1);
  const feedbackDuration = Number(settings.feedback_duration ?? 1);
  const rewardFeedbackDuration = Number(settings.reward_feedback_duration ?? 1);
  const itiDuration = Number(settings.iti_duration ?? 1);
  const scoreStep = Number(settings.delta ?? 1);
  const triggerMap = (settings.triggers ?? {}) as Record<string, unknown>;
  const trigger = (name: string, fallback: number): number => Number(triggerMap[name] ?? fallback);

  const choiceOption = (snapshot: TrialSnapshot): "easy" | "hard" =>
    resolveChoiceOption(resolveChoiceKey(snapshot.units.offer_choice?.response, offer.fallback_choice, easyKey, hardKey), hardKey);
  const chosenPresses = (snapshot: TrialSnapshot): number => (choiceOption(snapshot) === "hard" ? hardPresses : easyPresses);
  const chosenDeadline = (snapshot: TrialSnapshot): number => (choiceOption(snapshot) === "hard" ? hardDeadline : easyDeadline);
  const chosenReward = (snapshot: TrialSnapshot): number => (choiceOption(snapshot) === "hard" ? offer.hard_reward : easyReward);

  const offerFixation = trial.unit("offer_fixation").addStim(stimBank.get("fixation"));
  set_trial_context(offerFixation, {
    trial_id: trial.trial_id,
    phase: "offer_fixation",
    deadline_s: cueDuration,
    valid_keys: [],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "offer_fixation",
      offer_probability: offer.offer_probability,
      offer_hard_reward: offer.hard_reward,
      block_idx
    },
    stim_id: "fixation"
  });
  offerFixation.show({ duration: cueDuration, onset_trigger: trigger("cue_onset", 20) }).to_dict();

  const offerChoice = trial
    .unit("offer_choice")
    .addStim(
      stimBank.get_and_format("choice_header", {
        probability_pct: Math.round(offer.offer_probability * 100)
      })
    )
    .addStim(
      stimBank.get_and_format("choice_left", {
        easy_deadline_s: easyDeadline.toFixed(1),
        easy_presses: easyPresses,
        easy_reward: easyReward.toFixed(2)
      })
    )
    .addStim(
      stimBank.get_and_format("choice_right", {
        hard_deadline_s: hardDeadline.toFixed(1),
        hard_presses: hardPresses,
        hard_reward: offer.hard_reward.toFixed(2)
      })
    );
  set_trial_context(offerChoice, {
    trial_id: trial.trial_id,
    phase: "offer_choice",
    deadline_s: choiceDuration,
    valid_keys: [easyKey, hardKey],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "offer_choice",
      offer_probability: offer.offer_probability,
      offer_hard_reward: offer.hard_reward,
      offer_easy_reward: easyReward,
      easy_required_presses: easyPresses,
      hard_required_presses: hardPresses,
      easy_key: easyKey,
      hard_key: hardKey,
      block_idx
    },
    stim_id: "choice_layout"
  });
  offerChoice
    .captureResponse({
      keys: [easyKey, hardKey],
      correct_keys: [easyKey, hardKey],
      duration: choiceDuration,
      onset_trigger: trigger("choice_onset", 30),
      response_trigger: {
        [easyKey]: trigger("choice_easy_press", 31),
        [hardKey]: trigger("choice_hard_press", 32)
      },
      timeout_trigger: trigger("choice_no_response", 33),
      terminate_on_response: true
    })
    .set_state({
      choice_key: (snapshot: TrialSnapshot) =>
        resolveChoiceKey(snapshot.units.offer_choice?.response, offer.fallback_choice, easyKey, hardKey),
      choice_forced: (snapshot: TrialSnapshot) =>
        snapshot.units.offer_choice?.response !== easyKey && snapshot.units.offer_choice?.response !== hardKey,
      choice_forced_trigger: (snapshot: TrialSnapshot) =>
        snapshot.units.offer_choice?.response !== easyKey && snapshot.units.offer_choice?.response !== hardKey
          ? trigger("choice_forced", 34)
          : null,
      choice_option: choiceOption,
      required_presses: chosenPresses,
      effort_deadline_s: chosenDeadline,
      chosen_reward: chosenReward
    })
    .to_dict();

  const ready = trial
    .unit("ready")
    .addStim((snapshot: TrialSnapshot) =>
      stimBank.get_and_format("ready_text", {
        choice_label: choiceLabel(choiceOption(snapshot), settings),
        required_presses: chosenPresses(snapshot),
        effort_key: effortKey.toUpperCase(),
        time_limit_s: chosenDeadline(snapshot).toFixed(1)
      })
    );
  set_trial_context(ready, {
    trial_id: trial.trial_id,
    phase: "ready",
    deadline_s: readyDuration,
    valid_keys: [],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "ready",
      choice_option: choiceOption,
      required_presses: chosenPresses,
      effort_deadline_s: chosenDeadline,
      block_idx
    },
    stim_id: "ready_text"
  });
  ready.show({ duration: readyDuration, onset_trigger: trigger("ready_onset", 40) }).to_dict();

  const effortExecution = trial
    .unit("effort_execution")
    .addStim((snapshot: TrialSnapshot) =>
      stimBank.get_and_format("effort_prompt", {
        choice_label: choiceLabel(choiceOption(snapshot), settings),
        required_presses: chosenPresses(snapshot),
        effort_key: effortKey.toUpperCase(),
        time_limit_s: chosenDeadline(snapshot).toFixed(1)
      })
    )
    .addStim((snapshot: TrialSnapshot) =>
      stimBank.get_and_format("effort_counter", {
        current_presses: 0,
        required_presses: chosenPresses(snapshot),
        time_left_s: chosenDeadline(snapshot).toFixed(1)
      })
    );
  set_trial_context(effortExecution, {
    trial_id: trial.trial_id,
    phase: "effort_execution_window",
    deadline_s: hardDeadline,
    valid_keys: [effortKey],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "effort_execution_window",
      choice_option: choiceOption,
      required_presses: chosenPresses,
      effort_deadline_s: chosenDeadline,
      offer_probability: offer.offer_probability,
      offer_hard_reward: offer.hard_reward,
      offer_easy_reward: easyReward,
      chosen_reward: chosenReward,
      block_idx
    },
    stim_id: "effort_stage"
  });
  effortExecution
    .captureResponse({
      keys: [effortKey],
      correct_keys: [effortKey],
      duration: chosenDeadline,
      onset_trigger: trigger("target_onset", 50),
      response_trigger: trigger("target_key_press", 51),
      timeout_trigger: trigger("target_fail", 53),
      terminate_on_response: false,
      count_responses: true
    })
    .set_state({
      required_presses: chosenPresses,
      effort_deadline_s: chosenDeadline,
      effort_completed: (snapshot: TrialSnapshot) => effortCompleted(snapshot, easyPresses),
      target_outcome_trigger: (snapshot: TrialSnapshot) =>
        effortCompleted(snapshot, easyPresses) ? trigger("target_complete", 52) : trigger("target_fail", 53)
    })
    .to_dict();

  const effortFeedback = trial.unit("effort_feedback").addStim((snapshot: TrialSnapshot) =>
    effortCompleted(snapshot, easyPresses) ? stimBank.get("effort_success_feedback") : stimBank.get("effort_fail_feedback")
  );
  set_trial_context(effortFeedback, {
    trial_id: trial.trial_id,
    phase: "effort_feedback",
    deadline_s: feedbackDuration,
    valid_keys: [],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "effort_feedback",
      choice_option: choiceOption,
      effort_completed: (snapshot: TrialSnapshot) => effortCompleted(snapshot, easyPresses),
      block_idx
    },
    stim_id: (snapshot: TrialSnapshot) =>
      effortCompleted(snapshot, easyPresses) ? "effort_success_feedback" : "effort_fail_feedback"
  });
  effortFeedback
    .show({ duration: feedbackDuration, onset_trigger: trigger("feedback_onset", 60) })
    .set_state({
      press_count: (snapshot: TrialSnapshot) => countEffortPresses(snapshot),
      effort_completed: (snapshot: TrialSnapshot) => effortCompleted(snapshot, easyPresses)
    })
    .to_dict();

  const rewardWin = (snapshot: TrialSnapshot): boolean =>
    effortCompleted(snapshot, easyPresses) && offer.reward_draw_u < offer.offer_probability;
  const rewardStimId = (snapshot: TrialSnapshot): string => {
    if (!effortCompleted(snapshot, easyPresses)) return "reward_incomplete_feedback";
    return rewardWin(snapshot) ? "reward_win_feedback" : "reward_nowin_feedback";
  };
  const rewardFeedback = trial.unit("reward_feedback").addStim((snapshot: TrialSnapshot) => {
    if (!effortCompleted(snapshot, easyPresses)) return stimBank.get("reward_incomplete_feedback");
    if (rewardWin(snapshot)) {
      return stimBank.get_and_format("reward_win_feedback", { reward_amount: chosenReward(snapshot).toFixed(2) });
    }
    return stimBank.get("reward_nowin_feedback");
  });
  set_trial_context(rewardFeedback, {
    trial_id: trial.trial_id,
    phase: "reward_feedback",
    deadline_s: rewardFeedbackDuration,
    valid_keys: [],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "reward_feedback",
      choice_option: choiceOption,
      effort_completed: (snapshot: TrialSnapshot) => effortCompleted(snapshot, easyPresses),
      reward_win: rewardWin,
      reward_probability: offer.offer_probability,
      block_idx
    },
    stim_id: rewardStimId
  });
  rewardFeedback
    .show({
      duration: rewardFeedbackDuration,
      onset_trigger: (snapshot: TrialSnapshot) => {
        if (!effortCompleted(snapshot, easyPresses)) return trigger("reward_incomplete_onset", 72);
        return rewardWin(snapshot) ? trigger("reward_win_onset", 70) : trigger("reward_nowin_onset", 71);
      }
    })
    .set_state({
      reward_win: rewardWin,
      reward_amount: (snapshot: TrialSnapshot) => (rewardWin(snapshot) ? chosenReward(snapshot) : 0),
      reward_probability: offer.offer_probability
    })
    .to_dict();

  const iti = trial.unit("iti").addStim(stimBank.get("fixation"));
  set_trial_context(iti, {
    trial_id: trial.trial_id,
    phase: "inter_trial_interval",
    deadline_s: itiDuration,
    valid_keys: [],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "inter_trial_interval",
      block_idx
    },
    stim_id: "fixation"
  });
  iti.show({ duration: itiDuration, onset_trigger: trigger("iti_onset", 80) }).to_dict();

  trial.finalize((snapshot, _runtime, helpers) => {
    const choiceKey = String(snapshot.units.offer_choice?.choice_key ?? easyKey);
    const resolvedChoiceOption = resolveChoiceOption(choiceKey, hardKey);
    const requiredPresses = Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
    const pressCount = countEffortPresses(snapshot);
    const resolvedEffortCompleted = pressCount >= requiredPresses;
    const resolvedChosenReward = Number(snapshot.units.offer_choice?.chosen_reward ?? easyReward);
    const resolvedRewardWin = resolvedEffortCompleted && offer.reward_draw_u < offer.offer_probability;
    const rewardAmount = resolvedRewardWin ? resolvedChosenReward : 0;
    const accuracy = resolvedEffortCompleted;
    helpers.setTrialState("condition_label", offer.condition_id);
    helpers.setTrialState("offer_probability", offer.offer_probability);
    helpers.setTrialState("offer_hard_reward", offer.hard_reward);
    helpers.setTrialState("offer_easy_reward", easyReward);
    helpers.setTrialState("planned_trial_index", offer.trial_index);
    helpers.setTrialState("choice_option", resolvedChoiceOption);
    helpers.setTrialState("choice_key", choiceKey);
    helpers.setTrialState("choice_forced", snapshot.units.offer_choice?.choice_forced ?? false);
    helpers.setTrialState("effort_required_presses", requiredPresses);
    helpers.setTrialState("effort_press_count", pressCount);
    helpers.setTrialState("effort_completed", resolvedEffortCompleted);
    helpers.setTrialState("reward_win", resolvedRewardWin);
    helpers.setTrialState("reward_amount", rewardAmount);
    helpers.setTrialState("accuracy", accuracy);
    helpers.setTrialState("score_delta", accuracy ? scoreStep : 0);
  });

  return trial;
}

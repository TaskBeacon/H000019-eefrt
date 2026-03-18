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

function countEffortPresses(snapshot: TrialSnapshot, maxPresses: number): number {
  let count = 0;
  for (let index = 1; index <= maxPresses; index += 1) {
    if (snapshot.units[`effort_press_${index}`]?.key_press === true) {
      count += 1;
    }
  }
  return count;
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
  const easyPresses = Math.max(1, Number(settings.easy_required_presses ?? 6));
  const hardPresses = Math.max(easyPresses, Number(settings.hard_required_presses ?? 16));
  const maxPresses = hardPresses;
  const easyDeadline = Math.max(0.5, Number(settings.easy_time_limit_s ?? 4));
  const hardDeadline = Math.max(0.5, Number(settings.hard_time_limit_s ?? 8));

  const cueDuration = Number(settings.cue_duration ?? 0.8);
  const choiceDuration = Number(settings.anticipation_duration ?? 4);
  const readyDuration = Number(settings.ready_duration ?? 0.8);
  const feedbackDuration = Number(settings.feedback_duration ?? 0.8);
  const rewardFeedbackDuration = Number(settings.reward_feedback_duration ?? 0.8);
  const itiDuration = Number(settings.iti_duration ?? 0.8);
  const scoreStep = Number(settings.delta ?? 1);
  const triggerMap = (settings.triggers ?? {}) as Record<string, unknown>;

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
  offerFixation.show({ duration: cueDuration }).to_dict();

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
      response_trigger: {
        [easyKey]: Number(triggerMap.choice_easy_press ?? 31),
        [hardKey]: Number(triggerMap.choice_hard_press ?? 32)
      },
      timeout_trigger: Number(triggerMap.choice_no_response ?? 33),
      terminate_on_response: true
    })
    .set_state({
      choice_key: (snapshot: TrialSnapshot) =>
        resolveChoiceKey(snapshot.units.offer_choice?.response, offer.fallback_choice, easyKey, hardKey),
      choice_forced: (snapshot: TrialSnapshot) =>
        snapshot.units.offer_choice?.response !== easyKey &&
        snapshot.units.offer_choice?.response !== hardKey,
      choice_option: (snapshot: TrialSnapshot) =>
        resolveChoiceOption(
          resolveChoiceKey(snapshot.units.offer_choice?.response, offer.fallback_choice, easyKey, hardKey),
          hardKey
        ),
      required_presses: (snapshot: TrialSnapshot) =>
        resolveChoiceOption(
          resolveChoiceKey(snapshot.units.offer_choice?.response, offer.fallback_choice, easyKey, hardKey),
          hardKey
        ) === "hard"
          ? hardPresses
          : easyPresses,
      effort_deadline_s: (snapshot: TrialSnapshot) =>
        resolveChoiceOption(
          resolveChoiceKey(snapshot.units.offer_choice?.response, offer.fallback_choice, easyKey, hardKey),
          hardKey
        ) === "hard"
          ? hardDeadline
          : easyDeadline,
      chosen_reward: (snapshot: TrialSnapshot) =>
        resolveChoiceOption(
          resolveChoiceKey(snapshot.units.offer_choice?.response, offer.fallback_choice, easyKey, hardKey),
          hardKey
        ) === "hard"
          ? offer.hard_reward
          : easyReward
    })
    .to_dict();

  const ready = trial
    .unit("ready")
    .addStim((snapshot: TrialSnapshot) =>
      stimBank.get_and_format("ready_text", {
        choice_label: snapshot.units.offer_choice?.choice_option === "hard" ? "高努力" : "低努力",
        required_presses: snapshot.units.offer_choice?.required_presses ?? easyPresses,
        effort_key: effortKey.toUpperCase(),
        time_limit_s: Number(snapshot.units.offer_choice?.effort_deadline_s ?? easyDeadline).toFixed(1)
      })
    );
  ready.show({ duration: readyDuration }).to_dict();

  for (let pressIndex = 1; pressIndex <= maxPresses; pressIndex += 1) {
    const effortPress = trial
      .unit(`effort_press_${pressIndex}`)
      .when((snapshot: TrialSnapshot) => {
        const required = Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
        if (pressIndex > required) {
          return false;
        }
        for (let idx = 1; idx < pressIndex; idx += 1) {
          if (snapshot.units[`effort_press_${idx}`]?.key_press !== true) {
            return false;
          }
        }
        return true;
      })
      .addStim((snapshot: TrialSnapshot) =>
        stimBank.get_and_format("effort_prompt", {
          choice_label: snapshot.units.offer_choice?.choice_option === "hard" ? "高努力" : "低努力",
          required_presses: snapshot.units.offer_choice?.required_presses ?? easyPresses,
          effort_key: effortKey.toUpperCase(),
          time_limit_s: Number(snapshot.units.offer_choice?.effort_deadline_s ?? easyDeadline).toFixed(1)
        })
      )
      .addStim((snapshot: TrialSnapshot) => {
        const required = Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
        const deadline = Number(snapshot.units.offer_choice?.effort_deadline_s ?? easyDeadline);
        const perPressDuration = Math.max(0.15, deadline / Math.max(1, required));
        const remaining = Math.max(0, deadline - (pressIndex - 1) * perPressDuration);
        return stimBank.get_and_format("effort_counter", {
          current_presses: pressIndex - 1,
          required_presses: required,
          time_left_s: remaining.toFixed(1)
        });
      });
    set_trial_context(effortPress, {
      trial_id: trial.trial_id,
      phase: "effort_execution_window",
      deadline_s: hardDeadline,
      valid_keys: [effortKey],
      block_id,
      condition_id: offer.condition_id,
      task_factors: {
        stage: "effort_execution_window",
        offer_probability: offer.offer_probability,
        offer_hard_reward: offer.hard_reward,
        block_idx
      },
      stim_id: "effort_stage"
    });
    effortPress
      .captureResponse({
        keys: [effortKey],
        correct_keys: [effortKey],
        duration: (snapshot: TrialSnapshot) => {
          const required = Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
          const deadline = Number(snapshot.units.offer_choice?.effort_deadline_s ?? easyDeadline);
          return Math.max(0.15, deadline / Math.max(1, required));
        },
        response_trigger: Number(triggerMap.target_key_press ?? 51),
        timeout_trigger: Number(triggerMap.target_fail ?? 53),
        terminate_on_response: true
      })
      .set_state({
        press_index: pressIndex
      });
  }

  const effortFeedback = trial
    .unit("effort_feedback")
    .addStim((snapshot: TrialSnapshot) => {
      const required = Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
      const pressCount = countEffortPresses(snapshot, maxPresses);
      return pressCount >= required
        ? stimBank.get("effort_success_feedback")
        : stimBank.get("effort_fail_feedback");
    });
  set_trial_context(effortFeedback, {
    trial_id: trial.trial_id,
    phase: "effort_feedback",
    deadline_s: feedbackDuration,
    valid_keys: [],
    block_id,
    condition_id: offer.condition_id,
    task_factors: {
      stage: "effort_feedback",
      offer_probability: offer.offer_probability,
      offer_hard_reward: offer.hard_reward,
      block_idx
    },
    stim_id: "effort_feedback"
  });
  effortFeedback
    .show({ duration: feedbackDuration })
    .set_state({
      press_count: (snapshot: TrialSnapshot) => countEffortPresses(snapshot, maxPresses),
      effort_completed: (snapshot: TrialSnapshot) =>
        countEffortPresses(snapshot, maxPresses) >= Number(snapshot.units.offer_choice?.required_presses ?? easyPresses)
    })
    .to_dict();

  const rewardFeedback = trial
    .unit("reward_feedback")
    .addStim((snapshot: TrialSnapshot) => {
      const effortCompleted =
        countEffortPresses(snapshot, maxPresses) >= Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
      const chosenReward = Number(snapshot.units.offer_choice?.chosen_reward ?? easyReward);
      const rewardWin = effortCompleted && offer.reward_draw_u < offer.offer_probability;
      if (!effortCompleted) {
        return stimBank.get("reward_incomplete_feedback");
      }
      if (rewardWin) {
        return stimBank.get_and_format("reward_win_feedback", {
          reward_amount: chosenReward.toFixed(2)
        });
      }
      return stimBank.get("reward_nowin_feedback");
    });
  rewardFeedback
    .show({ duration: rewardFeedbackDuration })
    .set_state({
      reward_win: (snapshot: TrialSnapshot) => {
        const effortCompleted =
          countEffortPresses(snapshot, maxPresses) >=
          Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
        return effortCompleted && offer.reward_draw_u < offer.offer_probability;
      },
      reward_amount: (snapshot: TrialSnapshot) => {
        const effortCompleted =
          countEffortPresses(snapshot, maxPresses) >=
          Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
        const chosenReward = Number(snapshot.units.offer_choice?.chosen_reward ?? easyReward);
        const rewardWin = effortCompleted && offer.reward_draw_u < offer.offer_probability;
        return rewardWin ? chosenReward : 0;
      },
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
  iti.show({ duration: itiDuration }).to_dict();

  trial.finalize((snapshot, _runtime, helpers) => {
    const choiceKey = String(snapshot.units.offer_choice?.choice_key ?? easyKey);
    const choiceOption = resolveChoiceOption(choiceKey, hardKey);
    const requiredPresses = Number(snapshot.units.offer_choice?.required_presses ?? easyPresses);
    const pressCount = countEffortPresses(snapshot, maxPresses);
    const effortCompleted = pressCount >= requiredPresses;
    const chosenReward = Number(snapshot.units.offer_choice?.chosen_reward ?? easyReward);
    const rewardWin = effortCompleted && offer.reward_draw_u < offer.offer_probability;
    const rewardAmount = rewardWin ? chosenReward : 0;
    const accuracy = effortCompleted;
    helpers.setTrialState("condition_label", offer.condition_id);
    helpers.setTrialState("offer_probability", offer.offer_probability);
    helpers.setTrialState("offer_hard_reward", offer.hard_reward);
    helpers.setTrialState("offer_easy_reward", easyReward);
    helpers.setTrialState("planned_trial_index", offer.trial_index);
    helpers.setTrialState("choice_option", choiceOption);
    helpers.setTrialState("choice_key", choiceKey);
    helpers.setTrialState("choice_forced", snapshot.units.offer_choice?.choice_forced ?? false);
    helpers.setTrialState("effort_required_presses", requiredPresses);
    helpers.setTrialState("effort_press_count", pressCount);
    helpers.setTrialState("effort_completed", effortCompleted);
    helpers.setTrialState("reward_win", rewardWin);
    helpers.setTrialState("reward_amount", rewardAmount);
    helpers.setTrialState("accuracy", accuracy);
    helpers.setTrialState("score_delta", accuracy ? scoreStep : 0);
  });

  return trial;
}

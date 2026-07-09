import React, { useState, useEffect, useMemo, useCallback, useRef, useContext, createContext } from "react";
import { createPortal } from "react-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Dumbbell, Activity, Utensils, Scale, TrendingUp, Plus, Trash2, X, Footprints, Smile, Clock, Award, BarChart3,
  Check, Settings2, ChevronRight, ChevronUp, ChevronDown, GripVertical, Flame, Search, Calculator, Pencil,
} from "lucide-react";
import { Haptics } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";
import { App as CapApp } from "@capacitor/app";
import { registerPlugin, Capacitor } from "@capacitor/core";

// Our own custom native plugin (Android only — see
// android/app/src/main/java/.../StepCounterPlugin.java). No npm package;
// registerPlugin() bridges to it by name. Safely rejects in the browser
// preview / artifact (no native bridge), which callers below handle.
const StepCounterPlugin = registerPlugin("StepCounter");
const isAndroidStepRuntime = () => {
  try {
    return Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === "android";
  } catch (e) {
    return false;
  }
};


// Fire-and-forget haptic feedback. No-ops safely in the browser/artifact
// preview (no native bridge) and on any device without haptics support.
// Kept deliberately very subtle (a short vibrate), and gated by a
// user-toggleable on/off setting. Triggered from ONE global tap listener
// (see App's effect below) rather than scattered per-component calls, so
// every interactive tap gets consistent feedback and the on/off toggle
// reliably covers all of them.
let __hapticsEnabled = true;
function setHapticsEnabled(v) { __hapticsEnabled = v; }
function haptic() {
  if (!__hapticsEnabled) return;
  try {
    Haptics.vibrate({ duration: 4 }).catch(() => {});
  } catch (e) {
    // ignore — not running on a native platform
  }
}

function blurActiveInput() {
  try {
    const el = document.activeElement;
    if (el && typeof el.blur === "function") el.blur();
  } catch (e) {
    // ignore
  }
}

const DAILY_REMINDER_ID = 4171;
async function scheduleDailyReminder(hour, minute, titleKo, bodyKo) {
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return false;
    await LocalNotifications.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
    await LocalNotifications.schedule({
      notifications: [{
        id: DAILY_REMINDER_ID,
        title: titleKo,
        body: bodyKo,
        schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
      }],
    });
    return true;
  } catch (e) {
    return false; // not on a native platform, or plugin unavailable — safely no-op
  }
}
async function cancelDailyReminder() {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
  } catch (e) { /* ignore */ }
}

const REST_TIMER_NOTIF_ID = 4172;
// One-shot notification firing when a rest period ends — lets the phone be
// locked/backgrounded between sets without missing the "go again" cue.
async function scheduleRestTimerNotification(seconds, titleKo, bodyKo) {
  try {
    if (seconds <= 0) return false;
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return false;
    await LocalNotifications.cancel({ notifications: [{ id: REST_TIMER_NOTIF_ID }] });
    await LocalNotifications.schedule({
      notifications: [{
        id: REST_TIMER_NOTIF_ID,
        title: titleKo,
        body: bodyKo,
        schedule: { at: new Date(Date.now() + seconds * 1000), allowWhileIdle: true },
      }],
    });
    return true;
  } catch (e) {
    return false;
  }
}
async function cancelRestTimerNotification() {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REST_TIMER_NOTIF_ID }] });
  } catch (e) { /* ignore */ }
}

/* ---------------------------------------------------------
   COLOR PALETTES — clean modern themes. Each has the same shape
   so every component can just do `const theme = useTheme();`
--------------------------------------------------------- */
const PALETTES = {
  dark: {
    name: "Dark", isDark: true,
    bg: "#15120E", surface: "#211A14", surfaceRaised: "#2A241E", border: "#3A332D",
    text: "#F8EFD8", textDim: "#D8CBB2", textFaint: "#A99B86",
    lift: "#D9A028", run: "#287C8E", rest: "#3A332D", danger: "#C94E2A",
    gradA: "#D9A028", gradB: "#C94E2A", ring: "#D9A028", heroText: "#15120E", heroTextDim: "#4C3721",
    act: "#D9A028", eat: "#287C8E", plan: "#C94E2A", progress: "#2C8C9A", checkin: "#C26F6A",
    cream: "#F3E9D2", cream2: "#F8EFD8", darkPanel: "#1E1A16", darkPanel2: "#2A241E",
    rust: "#C94E2A", mustard: "#D9A028", teal: "#287C8E", brown: "#2B1F16",
    stripe: ["#D9A028", "#C94E2A", "#287C8E", "#F3E9D2"],
  },
  light: {
    name: "Light", isDark: false,
    bg: "#F3E9D2", surface: "#F8EFD8", surfaceRaised: "#EFE0BE", border: "#D4BE91",
    text: "#1E1A16", textDim: "#5C4A37", textFaint: "#8C765A",
    lift: "#D9A028", run: "#287C8E", rest: "#E7D5AF", danger: "#C94E2A",
    gradA: "#D9A028", gradB: "#C94E2A", ring: "#D9A028", heroText: "#15120E", heroTextDim: "#6B4B25",
    act: "#D9A028", eat: "#287C8E", plan: "#C94E2A", progress: "#2C8C9A", checkin: "#B66A64",
    cream: "#F3E9D2", cream2: "#F8EFD8", darkPanel: "#EAD7AD", darkPanel2: "#F1E1BB",
    rust: "#C94E2A", mustard: "#D9A028", teal: "#287C8E", brown: "#2B1F16",
    stripe: ["#D9A028", "#C94E2A", "#287C8E", "#2B1F16"],
  },
};
const DEFAULT_PALETTE = "dark";

// Clean modern health dashboard typography: one contemporary sans family across the app.
const FONT_STACK = "'Inter', 'DM Sans', 'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, -apple-system, sans-serif";
const MASTHEAD_FONT_STACK = FONT_STACK;
const BODY_FONT_STACK = FONT_STACK;

const ThemeContext = createContext(PALETTES[DEFAULT_PALETTE]);
function useTheme() {
  return useContext(ThemeContext);
}
function tint(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function mixHex(hexA, hexB, t) {
  const pa = hexA.replace("#", ""), pb = hexB.replace("#", "");
  const ar = parseInt(pa.substring(0, 2), 16), ag = parseInt(pa.substring(2, 4), 16), ab = parseInt(pa.substring(4, 6), 16);
  const br = parseInt(pb.substring(0, 2), 16), bg = parseInt(pb.substring(2, 4), 16), bb = parseInt(pb.substring(4, 6), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// A plain dark drop-shadow barely reads against an already-dark surface, so
// dark palettes get a soft light inner-glow border instead; light palettes
// keep the usual soft dark shadow.
function cardShadow(theme, strength = 0.15) {
  if (theme.isDark) {
    return `0 0 0 1px ${tint("#FFFFFF", strength * 0.4)}, 0 4px 14px ${tint("#000000", strength * 0.8)}`;
  }
  return `0 4px 14px ${tint(theme.text, strength)}`;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// --- DEV DATE OFFSET (testing only) ---------------------------------------
// Lets you fast-forward the app's notion of "today" (Day Log resets, TDEE
// calibration windows, etc.) from Settings, without touching the device
// clock. Purely a module-level value — resets to 0 on app restart.
let __devDateOffsetDays = 0;
function nowDate() {
  return new Date(Date.now() + __devDateOffsetDays * 86400000);
}
function setDevDateOffsetDays(days) { __devDateOffsetDays = days; }
function getDevDateOffsetDays() { return __devDateOffsetDays; }
// ---------------------------------------------------------------------------

// Local calendar-date string (YYYY-MM-DD) — deliberately NOT toISOString(),
// which converts to UTC and reports the wrong date during early-morning
// hours in timezones ahead of UTC (e.g. in KST, toISOString() still shows
// "yesterday" until 9am local time).
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const todayStr = () => localDateStr(nowDate());
const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
};

// Standard Atwater factors: protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g.
function autoCalories(protein, carbs, fat) {
  const kcal = (Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9;
  return kcal > 0 ? String(Math.round(kcal)) : "";
}

// Language: 'ko' or 'en'. Context so every component can read it without
// prop-drilling; t(ko, en) returns whichever string matches the language.
const LangContext = createContext("ko");
function useLang() {
  const lang = useContext(LangContext);
  const t = (ko, en) => (lang === "en" ? en : ko);
  return { lang, t };
}

const WEEKDAY_LABELS = {
  ko: ["월", "화", "수", "목", "금", "토", "일"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

// Purely observational estimate from logged weight-change + intake alone.
// Kept as the "observed" half of the blended engine below.
function computeObservedTdee(bodycomp, nutrition, windowDays) {
  const cutoff = nowDate();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const bc = [...bodycomp].filter((b) => new Date(b.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  const nu = nutrition.filter((n) => new Date(n.date) >= cutoff);
  if (bc.length < 2 || nu.length < 3) return null;
  const first = bc[0], last = bc[bc.length - 1];
  const days = (new Date(last.date) - new Date(first.date)) / 86400000;
  if (days < 3) return null;
  const weightChange = last.weight - first.weight;
  const dailyTotals = {};
  nu.forEach((n) => { dailyTotals[n.date] = (dailyTotals[n.date] || 0) + (+n.calories || 0); });
  const cals = Object.values(dailyTotals);
  const avgCal = cals.reduce((a, b) => a + b, 0) / cals.length;
  const tdee = avgCal - (weightChange * 7700) / days;
  return { tdee: Math.round(tdee / 10) * 10, avgCal: Math.round(avgCal), weightChange, days, loggedDays: cals.length };
}

/* ---------------------------------------------------------
   DIET ENGINE — ported from DietEngine.kt
   1) Initial TDEE = Mifflin-St Jeor BMR × non-exercise activity factor
      + weekly net exercise kcal / 7 (from actual logged workouts)
   2) After enough history, blend in an observed TDEE from logged
      weight-trend + intake, bounded to ±30% of the initial estimate
   3) Protein/fat are set first; carbs receive the remainder
   4) Safety warnings flag below-BMR targets, low energy availability, etc.
--------------------------------------------------------- */
const KCAL_PER_KG = 7700;

const ACTIVITY_LEVELS = [
  { id: "very_low", factor: 1.20, label: (t) => t("매우 적음 (주로 앉아서 생활)", "Very low (mostly seated)") },
  { id: "low", factor: 1.30, label: (t) => t("적음 (책상 업무, 3-6천보)", "Low (desk job, ~3-6k steps)") },
  { id: "moderate", factor: 1.40, label: (t) => t("보통 (일상 활동 많음, 6-9천보)", "Moderate (active daily routine, ~6-9k steps)") },
  { id: "high", factor: 1.50, label: (t) => t("높음 (서서/걷는 일, 9-12천보)", "High (standing/walking job, ~9-12k steps)") },
  { id: "very_high", factor: 1.65, label: (t) => t("매우 높음 (육체노동)", "Very high (physically demanding work)") },
];

function activityFactor(id) {
  return (ACTIVITY_LEVELS.find((a) => a.id === id) || ACTIVITY_LEVELS[1]).factor;
}

// Step-based activity bands, ported from DietEngineV3 (ActivityBand enum).
// Top tier aligned to 1.65 to match ACTIVITY_LEVELS exactly (single source
// of truth for factor↔label lookups used in the proposal UI).
function activityFactorFromSteps(steps) {
  if (steps < 4000) return 1.20;
  if (steps < 7000) return 1.30;
  if (steps < 10000) return 1.40;
  if (steps < 13000) return 1.50;
  return 1.65;
}

// Activity level now follows the same "propose, don't silently apply"
// pattern as TDEE calibration (see proposeActivityLevelChange below):
// - Full-automation mode (opt-in, settings.activityFullAutomation): use
//   the live step-derived factor directly, no review needed.
// - Default mode: use whatever activity level the person last accepted
//   (starting from the fixed settings.activityLevel baseline until they
//   accept their first step-based proposal). Nothing changes without an
//   explicit accept.
function resolveActivityFactor(settings, recentAvgSteps) {
  if (settings.activityFullAutomation && recentAvgSteps != null && recentAvgSteps >= 0) {
    return activityFactorFromSteps(recentAvgSteps);
  }
  if (settings.acceptedActivityLevel != null) return settings.acceptedActivityLevel;
  return activityFactor(settings.activityLevel);
}

// Weekly check-in: is the trailing step average now implying a different
// activity tier than what's currently active? Rate-limited to roughly
// once every 7 days so this doesn't nag more often than the underlying
// data can meaningfully change.
function proposeActivityLevelChange(t, settings, recentAvgSteps, lastProposalDateStr) {
  if (settings.activityFullAutomation) {
    return { eligible: false, note: t("전체 자동화 모드예요 — 별도 승인 없이 걸음수가 바로 반영돼요.", "Full automation is on — steps apply directly without a review step.") };
  }
  if (recentAvgSteps == null) {
    return { eligible: false, note: t("최근 완료된 날의 걸음수 기록이 더 필요해요.", "Need more completed days of step history first.") };
  }
  if (lastProposalDateStr) {
    const daysSince = (nowDate() - new Date(lastProposalDateStr + "T00:00:00")) / 86400000;
    if (daysSince < 7) {
      return { eligible: false, note: t("다음 확인은 7일 주기로 떠요.", "The next check-in is on a 7-day cycle.") };
    }
  }
  const currentFactor = settings.acceptedActivityLevel ?? activityFactor(settings.activityLevel);
  const impliedFactor = activityFactorFromSteps(recentAvgSteps);
  if (Math.abs(impliedFactor - currentFactor) < 0.001) {
    return { eligible: false, note: t("최근 걸음수가 현재 설정과 같은 수준이에요 — 바꿀 게 없어요.", "Recent steps match your current setting — nothing to change.") };
  }
  const impliedTier = ACTIVITY_LEVELS.find((a) => a.factor === impliedFactor) || ACTIVITY_LEVELS[1];
  return {
    eligible: true,
    currentFactor,
    impliedFactor,
    impliedTierLabel: impliedTier.label(t),
    avgSteps: Math.round(recentAvgSteps),
  };
}

function bmrMifflin(sex, ageYears, heightCm, weightKg) {
  const sexConstant = sex === "male" ? 5 : -161;
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + sexConstant;
}

function fatFreeMassKg(weightKg, bodyFatPercent) {
  if (bodyFatPercent == null || bodyFatPercent <= 0) return null;
  return weightKg * (1 - bodyFatPercent / 100);
}

// MET per workout type. MET already includes resting metabolism (1 MET),
// so we subtract 1 to avoid double-counting energy already covered by BMR.
function metForWorkout(w) {
  if (w.type === "lift") return 5.0; // general resistance training
  return 7.0; // recreational conversational-pace running (S.R/L.R)
}

function weeklyNetExerciseKcal(workouts, weightKg, windowDays = 14) {
  const cutoff = nowDate();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const recent = workouts.filter((w) => new Date(w.date) >= cutoff && (getDurationMin(w) || 0) > 0);
  const totalKcal = recent.reduce((sum, w) => {
    const netMet = Math.max(0, metForWorkout(w) - 1);
    const hours = (getDurationMin(w) || 0) / 60;
    return sum + netMet * weightKg * hours;
  }, 0);
  return totalKcal / (windowDays / 7); // normalized to a weekly average
}

function computeInitialTdee(settings, currentWeight, workouts, recentAvgSteps) {
  if (!settings.ageYears || !settings.heightCm || !currentWeight) return null;
  const bmr = bmrMifflin(settings.sex || "male", settings.ageYears, settings.heightCm, currentWeight);
  const nonExercise = bmr * resolveActivityFactor(settings, recentAvgSteps);
  const exerciseKcal = weeklyNetExerciseKcal(workouts, currentWeight) / 7;
  return { bmr, tdee: nonExercise + exerciseKcal };
}

// Blend the model-based initial estimate with an observed estimate from two
// 7-day blocks of logged weight + intake — bounded to ±30% of the initial
// estimate so short-term water/glycogen noise can't throw it off a cliff.
function calibrateTdee(initialTdee, bodycomp, nutrition, windowDays = 14) {
  const cutoff = nowDate();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const bc = [...bodycomp].filter((b) => new Date(b.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  const nu = nutrition.filter((n) => new Date(n.date) >= cutoff);
  const dailyTotals = {};
  nu.forEach((n) => { dailyTotals[n.date] = (dailyTotals[n.date] || 0) + (+n.calories || 0); });
  const loggedDays = Object.keys(dailyTotals).length;
  if (bc.length < 2 || loggedDays < 7) return { eligible: false };

  const mid = new Date(cutoff);
  mid.setDate(mid.getDate() + windowDays / 2);
  const firstHalf = bc.filter((b) => new Date(b.date) < mid);
  const secondHalf = bc.filter((b) => new Date(b.date) >= mid);
  if (firstHalf.length === 0 || secondHalf.length === 0) return { eligible: false };

  const avg = (arr) => arr.reduce((s, b) => s + b.weight, 0) / arr.length;
  const prevWeight = avg(firstHalf);
  const currWeight = avg(secondHalf);
  const cals = Object.values(dailyTotals);
  const avgIntake = cals.reduce((a, b) => a + b, 0) / cals.length;

  const kgPerDay = (currWeight - prevWeight) / (windowDays / 2);
  const observedTdee = avgIntake - kgPerDay * KCAL_PER_KG;
  const bounded = Math.min(Math.max(observedTdee, initialTdee * 0.70), initialTdee * 1.30);

  const blendWeight = Math.min(0.45, Math.max(0.25, loggedDays / windowDays * 0.45));
  const blended = initialTdee * (1 - blendWeight) + bounded * blendWeight;

  return { eligible: true, observedTdee: bounded, blendedTdee: blended, loggedDays };
}

// Ported from DietEngineV3.proposeCalibration — unlike calibrateTdee above
// (which blends automatically), this never changes the target by itself.
// It only produces a reviewable proposal that the person must explicitly
// accept (see acceptTdeeCalibration below). Much stricter data
// requirements (28-day window, high-quality intake days, fasted-morning
// weights) make the estimate more trustworthy, at the cost of needing more
// consistent logging before it becomes available.
const CALIBRATION_WINDOW_DAYS = 28;
const MIN_COMPLETE_INTAKE_DAYS = 24;
const MIN_FASTED_WEIGHT_DAYS = 18;
const MIN_INTAKE_QUALITY = 0.80;
const MAX_TDEE_CHANGE_PER_ACCEPTANCE = 150;

function proposeTdeeCalibration(t, currentTdee, bodycomp, nutrition, lastAcceptedDateStr) {
  const today = nowDate();
  if (lastAcceptedDateStr) {
    const daysSinceAccepted = (today - new Date(lastAcceptedDateStr + "T00:00:00")) / 86400000;
    if (daysSinceAccepted < 7) {
      return { eligible: false, note: t("최근 보정을 승인한 지 7일이 지나야 다음 제안이 나와요.", "Wait at least 7 days after the last accepted calibration before the next proposal.") };
    }
  }

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (CALIBRATION_WINDOW_DAYS - 1));

  const byDate = {};
  nutrition.forEach((n) => {
    if (new Date(n.date) < cutoff) return;
    if (!byDate[n.date]) byDate[n.date] = { cal: 0, qSum: 0, qCount: 0 };
    byDate[n.date].cal += (+n.calories || 0);
    byDate[n.date].qSum += (n.quality ?? 0.8);
    byDate[n.date].qCount += 1;
  });
  const intakeDays = Object.values(byDate).map((d) => ({ cal: d.cal, quality: d.qSum / d.qCount }));
  const reliableIntake = intakeDays.filter((d) => d.quality >= MIN_INTAKE_QUALITY);
  const meanQuality = reliableIntake.length ? reliableIntake.reduce((s, d) => s + d.quality, 0) / reliableIntake.length : 0;

  const fastedWeights = bodycomp.filter((b) => new Date(b.date) >= cutoff && (b.condition ?? "unknown") === "fasted");

  if (reliableIntake.length < MIN_COMPLETE_INTAKE_DAYS || fastedWeights.length < MIN_FASTED_WEIGHT_DAYS || meanQuality < MIN_INTAKE_QUALITY) {
    return {
      eligible: false,
      completeIntakeDays: reliableIntake.length,
      fastedWeightDays: fastedWeights.length,
      meanQuality,
      note: t(
        `최근 28일 중 신뢰도 높은 식단 기록 ${MIN_COMPLETE_INTAKE_DAYS}일, 공복 체중 기록 ${MIN_FASTED_WEIGHT_DAYS}일이 필요해요 (현재 ${reliableIntake.length}일 · ${fastedWeights.length}일).`,
        `Need ${MIN_COMPLETE_INTAKE_DAYS} high-quality intake days and ${MIN_FASTED_WEIGHT_DAYS} fasted-morning weight days in the last 28 (currently ${reliableIntake.length}d · ${fastedWeights.length}d).`
      ),
    };
  }

  const meanIntake = reliableIntake.reduce((s, d) => s + d.cal, 0) / reliableIntake.length;
  const points = fastedWeights.map((b) => [new Date(b.date).getTime() / 86400000, b.weight]);
  const xMean = points.reduce((s, p) => s + p[0], 0) / points.length;
  const yMean = points.reduce((s, p) => s + p[1], 0) / points.length;
  const num = points.reduce((s, p) => s + (p[0] - xMean) * (p[1] - yMean), 0);
  const den = points.reduce((s, p) => s + (p[0] - xMean) ** 2, 0);
  const slopePerDay = den === 0 ? 0 : num / den;

  const observedTdee = meanIntake - slopePerDay * KCAL_PER_KG;
  const bounded = Math.min(Math.max(observedTdee, currentTdee * 0.75), currentTdee * 1.25);

  const coverage = reliableIntake.length / CALIBRATION_WINDOW_DAYS;
  const confidence = Math.min(0.95, Math.max(0.20, coverage * meanQuality));

  const alpha = Math.min(0.35, Math.max(0.20, 0.15 + 0.20 * confidence));
  const rawChange = (bounded - currentTdee) * alpha;
  const cappedChange = Math.min(MAX_TDEE_CHANGE_PER_ACCEPTANCE, Math.max(-MAX_TDEE_CHANGE_PER_ACCEPTANCE, rawChange));
  const proposedTdee = Math.round(currentTdee + cappedChange);

  return {
    eligible: true,
    observedTdee: Math.round(bounded),
    proposedTdee,
    changeKcal: proposedTdee - Math.round(currentTdee),
    confidence,
    completeIntakeDays: reliableIntake.length,
    fastedWeightDays: fastedWeights.length,
    meanQuality,
    note: confidence < 0.55
      ? t("신뢰도가 낮은 편이에요 — 외식/여행/컨디션 난조가 있던 날은 없었는지 확인 후 승인해보세요.", "Confidence is on the low side — check for restaurant meals, travel, or off days before accepting.")
      : t("주간 체크인에서만 적용하세요. 매일 목표를 바꾸지 마세요.", "Apply this only at a weekly check-in — don't change your daily target more often than that."),
  };
}

// Fat-loss deficit: requested rate, but clamped to sane bounds (200-900 kcal,
// never more than 30% of TDEE) so an aggressive rate% on a heavy bodyweight
// can't produce an unreasonably large default deficit.
function dailyTargetForRate(tdee, weightKg, weeklyChangeFraction, bmr, sex) {
  const requestedDeficit = (weightKg * weeklyChangeFraction * KCAL_PER_KG) / 7;
  const deficit = Math.min(Math.max(requestedDeficit, 200), Math.min(900, tdee * 0.30));
  const rawTarget = tdee - deficit;
  // Hard floor — not just a warning after the fact. Never recommend eating
  // below BMR, and never below a widely-cited clinical minimum (1200 kcal
  // female / 1500 kcal male) even if BMR itself is lower than that for a
  // smaller person — these are independent safety floors.
  const clinicalFloor = sex === "female" ? 1200 : 1500;
  const floor = bmr != null ? Math.max(bmr, clinicalFloor) : clinicalFloor;
  return Math.max(rawTarget, floor);
}

// Lean-gain surplus: conservative by design, capped at 100-300 kcal and
// never more than 15% of TDEE (mirrors DietEngine.kt's GAIN branch).
function dailyTargetForGain(tdee, weightKg, weeklyGainFraction) {
  const requestedSurplus = (weightKg * weeklyGainFraction * KCAL_PER_KG) / 7;
  const surplus = Math.min(Math.max(requestedSurplus, 100), Math.min(300, tdee * 0.15));
  return tdee + surplus;
}

// Calorie cycling: training days get extra calories, rest days compensate,
// so the weekly total stays equal to baseDailyTargetKcal × 7.
function cycleTargets(baseDailyTargetKcal, trainingDaysPerWeek, trainingDayExtraKcal = 150) {
  if (trainingDaysPerWeek <= 0 || trainingDaysPerWeek >= 7) {
    return { training: Math.round(baseDailyTargetKcal), rest: Math.round(baseDailyTargetKcal) };
  }
  const restDays = 7 - trainingDaysPerWeek;
  const training = baseDailyTargetKcal + trainingDayExtraKcal;
  const rest = baseDailyTargetKcal - Math.round((trainingDayExtraKcal * trainingDaysPerWeek) / restDays);
  return { training: Math.round(training), rest: Math.round(rest) };
}

// Cheat/refeed day budget: keeps the planned weekly calorie total unchanged
// by borrowing from the other days, capped at 120% of TDEE.
function specialDayBudget(tdeeKcal, normalDailyTargetKcal, specialDaysPerWeek = 1) {
  const weeklyBudget = normalDailyTargetKcal * 7;
  const normalDays = 7 - specialDaysPerWeek;
  const raw = (weeklyBudget - normalDailyTargetKcal * normalDays) / specialDaysPerWeek;
  return Math.min(raw, tdeeKcal * 1.20);
}

// Reverse-diet / maintenance ramp: nudges a below-maintenance target back up
// toward TDEE in small steps, pausing if weight is still climbing fast.
function nextMaintenanceRampTarget(currentTargetKcal, effectiveTdeeKcal, recentWeeklyWeightChangePercent) {
  if (currentTargetKcal >= effectiveTdeeKcal) return effectiveTdeeKcal;
  if (recentWeeklyWeightChangePercent > 0.25) return currentTargetKcal;
  return Math.min(currentTargetKcal + 100, effectiveTdeeKcal);
}

// Protein: use fat-free mass when body-fat is known and either high (avoid
// scaling protein off adipose mass) or a lean cut (protect muscle harder);
// otherwise a straightforward g/kg bodyweight rule.
function proteinTarget(sex, weightKg, bodyFatPercent) {
  const ffm = fatFreeMassKg(weightKg, bodyFatPercent);
  const bf = bodyFatPercent;
  const highBodyFat = sex === "male" ? bf != null && bf >= 25 : bf != null && bf >= 35;
  const leanCut = bf != null && (sex === "male" ? bf <= 15 : bf <= 25);
  if (highBodyFat && ffm != null) return 2.0 * ffm;
  if (leanCut && ffm != null) return 2.6 * ffm;
  return 1.8 * weightKg;
}

function macrosFor(targetKcal, weightKg, sex, bodyFatPercent, carbPercent = null) {
  const proteinG = proteinTarget(sex, weightKg, bodyFatPercent);
  if (carbPercent != null) {
    // user-set carb ratio: protein stays FFM/weight-based, carbs come straight
    // from the chosen % of calories, fat absorbs whatever's left.
    const carbG = Math.max(0, (targetKcal * (carbPercent / 100)) / 4);
    const fatG = Math.max(0, (targetKcal - proteinG * 4 - carbG * 4) / 9);
    return { calories: Math.round(targetKcal), proteinG: Math.round(proteinG), fatG: Math.round(fatG), carbG: Math.round(carbG) };
  }
  const fatFloorByWeight = 0.60 * weightKg;
  const fatFloorByEnergy = (targetKcal * 0.20) / 9;
  const fatG = Math.max(fatFloorByWeight, fatFloorByEnergy);
  const carbG = Math.max(0, (targetKcal - proteinG * 4 - fatG * 9) / 4);
  return { calories: Math.round(targetKcal), proteinG: Math.round(proteinG), fatG: Math.round(fatG), carbG: Math.round(carbG) };
}

// Resolves the user's selected mode + sub-tier into a concrete daily target
// and macro split. Single source of truth shared by Dashboard, the
// Maintenance tab, and the Nutrition tab.
const CUT_TIERS = {
  gentle: { frac: 0.005, label: (t) => t("완만 (~0.5%/주)", "Gentle (~0.5%/wk)") },
  standard: { frac: 0.007, label: (t) => t("표준 (~0.7%/주)", "Standard (~0.7%/wk)") },
  fast: { frac: 0.01, label: (t) => t("빠름 (~1%/주)", "Fast (~1%/wk)") },
};
const GAIN_TIERS = {
  lean: { frac: 0.0015, label: (t) => t("린벌크 (~0.15%/주)", "Lean (~0.15%/wk)") },
  standard: { frac: 0.0025, label: (t) => t("표준 (~0.25%/주)", "Standard (~0.25%/wk)") },
};
const CARB_PRESETS = [
  { id: "auto", pct: null, label: (t) => t("자동", "Auto") },
  { id: "low", pct: 20, label: (t) => t("낮음 20%", "Low 20%") },
  { id: "moderate", pct: 40, label: (t) => t("보통 40%", "Moderate 40%") },
  { id: "high", pct: 55, label: (t) => t("높음 55%", "High 55%") },
];

// Ported from DietEngineV3.recommendedLossRateRange — a leanness-aware
// suggested range (fraction of bodyweight/week), rather than one fixed
// range for everyone. Returns null if body fat isn't known.
function recommendedLossRateRange(sex, bodyFatPercent) {
  if (bodyFatPercent == null) return null;
  const lean = (sex === "male" && bodyFatPercent <= 15) || (sex !== "male" && bodyFatPercent <= 25);
  const higherBF = (sex === "male" && bodyFatPercent >= 25) || (sex !== "male" && bodyFatPercent >= 35);
  if (lean) return [0.0025, 0.0050];
  if (higherBF) return [0.0050, 0.0100];
  return [0.0040, 0.0075];
}

function computeActiveTarget(settings, effectiveTdee, currentWeight, currentBF) {
  if (!effectiveTdee || !currentWeight) return null;
  const mode = settings.goalMode || "cut";
  const carbPercent = settings.carbPercent ?? null;
  const medicalBlock = settings.pregnantOrBreastfeeding || settings.edRecoveryOrClinical;
  if (mode === "cut" && medicalBlock) {
    // Don't compute or suggest a specific deficit target — this mirrors
    // DietEngineV3's safetyWarnings REVIEW_REQUIRED gate for pregnancy/
    // breastfeeding and ED-recovery/clinical-restriction contexts.
    const macros = macrosFor(effectiveTdee, currentWeight, settings.sex, currentBF, carbPercent);
    return { mode, tierKey: null, target: effectiveTdee, macros, blocked: true };
  }
  let target, tierKey, tierDef;
  if (mode === "gain") {
    tierKey = settings.gainTier || "lean";
    tierDef = GAIN_TIERS[tierKey] || GAIN_TIERS.lean;
    target = dailyTargetForGain(effectiveTdee, currentWeight, tierDef.frac);
  } else if (mode === "maintain") {
    tierKey = null;
    target = effectiveTdee;
  } else {
    tierKey = settings.cutTier || "standard";
    tierDef = CUT_TIERS[tierKey] || CUT_TIERS.standard;
    const bmr = (settings.ageYears && settings.heightCm && currentWeight)
      ? bmrMifflin(settings.sex || "male", settings.ageYears, settings.heightCm, currentWeight)
      : null;
    target = dailyTargetForRate(effectiveTdee, currentWeight, tierDef.frac, bmr, settings.sex);
  }
  const macros = macrosFor(target, currentWeight, settings.sex, currentBF, carbPercent);
  return { mode, tierKey, target, macros, blocked: false };
}

function dietEngineWarnings(t, { tdee, bmr, targetKcal, ffmKg, exerciseKcalPerDay, macros, weeklyChangeFraction, bmi, goalMode }) {
  const warnings = [];
  if (goalMode === "cut" && weeklyChangeFraction > 0.0125) {
    warnings.push({ severity: "review", message: t("감량 속도가 체중의 1.25%/주를 넘어요 — 추가로 감량 속도를 높이기 전에 점검이 필요해요 (근손실·요요·컨디션 저하 위험이 커요).", "Loss rate is above 1.25% bodyweight/week — this needs a review before going any faster (higher risk of muscle loss, rebound, and poor recovery).") });
  } else if (goalMode === "cut" && weeklyChangeFraction > 0.010) {
    warnings.push({ severity: "caution", message: t("감량 속도가 체중의 1%/주를 넘어요 — 장기적으로 근손실·요요 위험이 커집니다.", "Your loss rate is above 1% bodyweight/week — higher risk of muscle loss and rebound long-term.") });
  }
  if (goalMode === "cut" && bmi != null && bmi < 18.5) {
    warnings.push({ severity: "review", message: t("BMI가 18.5 미만이에요 — 이 체구에서는 다이어트 자동 목표를 권장하지 않아요. 필요하면 전문가와 상담해보세요.", "BMI is under 18.5 — an automated cut target isn't appropriate at this size. Consider checking with a professional if this applies to you.") });
  }
  if (targetKcal < bmr) {
    warnings.push({ severity: "caution", message: t("목표 섭취량이 기초대사량(BMR)보다 낮아요. 항상 위험한 건 아니지만 기본값으로 두기엔 신중해야 해요.", "Target intake is below your estimated BMR. Not automatically unsafe, but shouldn't be a casual default.") });
  }
  if (ffmKg != null) {
    const availability = (targetKcal - exerciseKcalPerDay) / ffmKg;
    if (availability < 30) {
      warnings.push({ severity: "caution", message: t("제지방량 대비 에너지 가용성이 낮아요 (30kcal/kg 미만) — 생리 불순, 회복 저하 등 저에너지 위험 신호일 수 있어요.", "Energy availability relative to lean mass is low (<30 kcal/kg) — a possible under-fuelling / RED-S warning sign.") });
    }
  }
  if (macros.carbG <= 0) {
    warnings.push({ severity: "caution", message: t("단백질·지방 하한선만으로 탄수화물 여유가 없어요 — 총 칼로리를 올리거나 매크로를 직접 조정해보세요.", "Protein and fat floors leave no room for carbs — raise total calories or adjust macros manually.") });
  }
  return warnings;
}

function estimateTdeeEngine(settings, bodycomp, nutrition, workouts, currentWeight, recentAvgSteps) {
  const initial = computeInitialTdee(settings, currentWeight, workouts, recentAvgSteps);
  if (!initial) return null;
  const calib = calibrateTdee(initial.tdee, bodycomp, nutrition, 14);
  const effectiveTdee = calib.eligible ? calib.blendedTdee : initial.tdee;
  return { bmr: initial.bmr, initialTdee: initial.tdee, calibration: calib, effectiveTdee };
}

// Week plan is now user-editable (day -> lift program / run type / rest).
// Starts fully blank (all rest) so every new user configures their own
// schedule from scratch rather than inheriting someone else's plan.
const DEFAULT_WEEK_PLAN = [
  { day: "월", kind: "rest" },
  { day: "화", kind: "rest" },
  { day: "수", kind: "rest" },
  { day: "목", kind: "rest" },
  { day: "금", kind: "rest" },
  { day: "토", kind: "rest" },
  { day: "일", kind: "rest" },
];

// Per-100g macros. Values are standard reference nutrition data (the same
// USDA-derived figures sites like nutritionvalue.org display), not a live
// scrape — the artifact sandbox can't make arbitrary network calls to
// third-party sites. Users can also add their own foods, saved locally.
const FOOD_DB = [
  { name: "백미밥 (지은 밥)", nameEn: "White rice (cooked)", cal: 130, p: 2.7, c: 28.2, f: 0.3 },
  { name: "현미밥 (지은 밥)", nameEn: "Brown rice (cooked)", cal: 123, p: 2.6, c: 25.6, f: 1.0 },
  { name: "닭가슴살 (구움/삶음, 껍질 없음)", nameEn: "Chicken breast (grilled/boiled, skinless)", cal: 165, p: 31.0, c: 0, f: 3.6 },
  { name: "닭다리살 (구움, 껍질 없음)", nameEn: "Chicken thigh (grilled, skinless)", cal: 172, p: 25.0, c: 0, f: 8.3 },
  { name: "계란 (삶음)", nameEn: "Egg (boiled)", cal: 155, p: 13.0, c: 1.1, f: 11.0 },
  { name: "계란흰자", nameEn: "Egg white", cal: 52, p: 11.0, c: 0.7, f: 0.2 },
  { name: "소고기 등심 (구움)", nameEn: "Beef sirloin (grilled)", cal: 250, p: 26.0, c: 0, f: 15.0 },
  { name: "돼지고기 목살 (구움)", nameEn: "Pork shoulder (grilled)", cal: 297, p: 25.0, c: 0, f: 21.0 },
  { name: "돼지고기 삼겹살 (구움)", nameEn: "Pork belly (grilled)", cal: 397, p: 21.0, c: 0, f: 34.0 },
  { name: "연어 (구움)", nameEn: "Salmon (grilled)", cal: 208, p: 20.0, c: 0, f: 13.0 },
  { name: "참치 (캔, 물)", nameEn: "Tuna (canned, in water)", cal: 116, p: 26.0, c: 0, f: 1.0 },
  { name: "새우", nameEn: "Shrimp", cal: 99, p: 24.0, c: 0.2, f: 0.3 },
  { name: "두부", nameEn: "Tofu", cal: 76, p: 8.0, c: 1.9, f: 4.8 },
  { name: "김치", nameEn: "Kimchi", cal: 15, p: 1.1, c: 2.4, f: 0.5 },
  { name: "고구마 (삶음)", nameEn: "Sweet potato (boiled)", cal: 90, p: 2.0, c: 20.7, f: 0.1 },
  { name: "감자 (삶음)", nameEn: "Potato (boiled)", cal: 87, p: 1.9, c: 20.1, f: 0.1 },
  { name: "바나나", nameEn: "Banana", cal: 89, p: 1.1, c: 22.8, f: 0.3 },
  { name: "사과", nameEn: "Apple", cal: 52, p: 0.3, c: 13.8, f: 0.2 },
  { name: "그릭요거트 (무가당)", nameEn: "Greek yogurt (unsweetened)", cal: 59, p: 10.0, c: 3.6, f: 0.4 },
  { name: "우유 (일반)", nameEn: "Milk (whole)", cal: 61, p: 3.2, c: 4.8, f: 3.3 },
  { name: "아몬드", nameEn: "Almonds", cal: 579, p: 21.2, c: 21.6, f: 49.9 },
  { name: "땅콩버터", nameEn: "Peanut butter", cal: 588, p: 25.0, c: 20.0, f: 50.0 },
  { name: "올리브오일", nameEn: "Olive oil", cal: 884, p: 0, c: 0, f: 100.0 },
  { name: "오트밀 (건조)", nameEn: "Oats (dry)", cal: 389, p: 16.9, c: 66.3, f: 6.9 },
  { name: "통밀식빵", nameEn: "Whole wheat bread", cal: 247, p: 13.0, c: 41.0, f: 3.4 },
  { name: "흰식빵", nameEn: "White bread", cal: 265, p: 9.0, c: 49.0, f: 3.2 },
  { name: "브로콜리 (삶음)", nameEn: "Broccoli (boiled)", cal: 35, p: 2.4, c: 7.2, f: 0.4 },
  { name: "시금치 (생)", nameEn: "Spinach (raw)", cal: 23, p: 2.9, c: 3.6, f: 0.4 },
  { name: "아보카도", nameEn: "Avocado", cal: 160, p: 2.0, c: 8.5, f: 14.7 },
  { name: "검은콩 (삶음)", nameEn: "Black beans (boiled)", cal: 132, p: 8.9, c: 23.7, f: 0.5 },
  { name: "렌틸콩 (삶음)", nameEn: "Lentils (boiled)", cal: 116, p: 9.0, c: 20.1, f: 0.4 },
  { name: "병아리콩 (삶음)", nameEn: "Chickpeas (boiled)", cal: 164, p: 8.9, c: 27.4, f: 2.6 },
  { name: "파스타 (삶음)", nameEn: "Pasta (cooked)", cal: 131, p: 5.0, c: 25.0, f: 1.1 },
  { name: "현미/귀리 시리얼", nameEn: "Brown rice / oat cereal", cal: 379, p: 8.0, c: 79.0, f: 3.0 },
  { name: "웨이 프로틴 파우더", nameEn: "Whey protein powder", cal: 380, p: 80.0, c: 8.0, f: 4.0 },
  { name: "비빔밥 재료 (밥+나물+고기, 소스 제외)", nameEn: "Bibimbap mix (rice+veg+meat, no sauce)", cal: 130, p: 6.0, c: 18.0, f: 3.5 },
  { name: "김밥", nameEn: "Gimbap", cal: 150, p: 4.5, c: 24.0, f: 3.5 },
  { name: "라면 (건면+스프)", nameEn: "Instant ramen (dry noodle + soup base)", cal: 500, p: 10.0, c: 65.0, f: 20.0 },
  { name: "떡볶이", nameEn: "Tteokbokki", cal: 145, p: 2.5, c: 30.0, f: 1.5 },
  { name: "치즈 (체다)", nameEn: "Cheese (cheddar)", cal: 402, p: 25.0, c: 1.3, f: 33.0 },
];

// Work-set structure per exercise, seeded from the plan's Push/Legs/Pull
// pages (warmup sets aren't tracked — only the work sets that matter for
// the progression system). Users can rename, add, remove, and create whole
// new programs from the home screen.
const DEFAULT_PROGRAMS = [
  {
    id: "push", name: "Push",
    exercises: [
      { name: "인클라인/플랫 덤벨 프레스", nameEn: "Incline / Flat DB Press", sets: 2, repRange: "6-12", muscle: "chest" },
      { name: "시티드 덤벨 숄더 프레스", nameEn: "Seated DB Shoulder Press", sets: 2, repRange: "6-12", muscle: "shoulders" },
      { name: "딥스 (웨이트/머신)", nameEn: "Dips (Weighted / Machine)", sets: 2, repRange: "6-12", muscle: "triceps" },
      { name: "펙덱 또는 케이블 플라이", nameEn: "Pec Deck or Cable Fly", sets: 2, repRange: "6-12", muscle: "chest" },
    ],
  },
  {
    id: "legs", name: "Legs",
    exercises: [
      { name: "스쿼트", nameEn: "Squats", sets: 3, repRange: "4-6", muscle: "quads" },
      { name: "RDL (바벨/덤벨)", nameEn: "RDL (Barbell / DB)", sets: 2, repRange: "8-10", muscle: "hamstrings" },
      { name: "덤벨 런지", nameEn: "DB Lunges", sets: 2, repRange: "8-12", muscle: "quads" },
      { name: "카프 레이즈", nameEn: "Calf Raises", sets: 2, repRange: "8-12", muscle: "calves" },
    ],
  },
  {
    id: "pull", name: "Pull",
    exercises: [
      { name: "덤벨/바벨 로우", nameEn: "DB / BB Row", sets: 2, repRange: "6-12", muscle: "back" },
      { name: "풀업 또는 랫 풀다운", nameEn: "Pull-Ups or Lat Pulldown", sets: 2, repRange: "6-12", muscle: "back" },
      { name: "바벨 바이셉 컬", nameEn: "BB Biceps Curls", sets: 2, repRange: "8-10", muscle: "biceps" },
      { name: "랫 풀오버", nameEn: "Lat Pullover", sets: 2, repRange: "10-12", muscle: "back" },
    ],
  },
];

// Muscle-group catalog shared by the body-diagram breakdown and the
// exercise-muscle picker. Front/back indicates which diagram view a group
// is visualized on (some, like back/biceps, show on the back view; most
// upper-body pushing/quad work shows on the front).
const MUSCLE_GROUPS = {
  chest: { view: "front", label: (t) => t("가슴", "Chest") },
  shoulders: { view: "front", label: (t) => t("어깨", "Shoulders") },
  triceps: { view: "back", label: (t) => t("삼두", "Triceps") },
  biceps: { view: "front", label: (t) => t("이두", "Biceps") },
  back: { view: "back", label: (t) => t("등", "Back") },
  quads: { view: "front", label: (t) => t("대퇴사두", "Quads") },
  hamstrings: { view: "back", label: (t) => t("햄스트링", "Hamstrings") },
  calves: { view: "back", label: (t) => t("종아리", "Calves") },
  core: { view: "front", label: (t) => t("코어", "Core") },
  glutes: { view: "back", label: (t) => t("둔근", "Glutes") },
};

// Progressive overload is derived from the exercise's own repRange (e.g.
// "6-12" → start 6, cap 12) rather than needing a whole separate config
// UI — the rep range the person already set per exercise already encodes
// exactly the range progressive overload should climb through.
function parseRepRange(repRange) {
  const match = /(\d+)\s*-\s*(\d+)/.exec(repRange || "");
  if (!match) return { startReps: 8, maxReps: 12 };
  const a = Number(match[1]), b = Number(match[2]);
  return { startReps: Math.min(a, b), maxReps: Math.max(a, b) };
}

function poStateKey(programId, exerciseName) {
  return `${programId}::${exerciseName}`;
}

// This week's target rep count for the top/working sets: starts at
// startReps and climbs by 1 per calendar week since the current cycle
// began, capped at maxReps — matching "매주 하나씩 올리기" (increase by
// one rep every week) up to the ceiling.
function currentTargetReps(poEntry, startReps, maxReps) {
  if (!poEntry || !poEntry.cycleStart) return startReps;
  const weeksSince = Math.floor((nowDate() - new Date(poEntry.cycleStart + "T00:00:00")) / (7 * 86400000));
  return Math.min(maxReps, startReps + Math.max(0, weeksSince));
}



const makeExercisesFromPlan = (planExercises, lang) => {
  if (!planExercises) return [];
  return planExercises.map((ex) => ({
    name: lang === "en" && ex.nameEn ? ex.nameEn : ex.name, repRange: ex.repRange, muscle: ex.muscle || null,
    sets: Array.from({ length: Math.max(1, Math.round(Number(ex.sets)) || 1) }, () => ({ weight: "", reps: "" })),
  }));
};

const DEFAULT_CARD_ORDER = ["goalProgress", "weekPlan", "steps", "dayLog", "maintenance"];

const DEFAULT_SETTINGS = {
  userName: "USERNAME",
  language: "ko",
  colorPalette: DEFAULT_PALETTE,
  devDateOffsetDays: 0,
  goalMode: "cut",
  cutTier: "standard",
  gainTier: "lean",
  carbPercent: null,
  dashboardCardOrder: DEFAULT_CARD_ORDER,
  reorderHintDismissed: false,
  hasOnboarded: false,
  dailyReminderEnabled: false,
  dailyReminderHour: 20,
  dailyReminderMinute: 0,
  hapticsEnabled: true,
  pregnantOrBreastfeeding: false,
  edRecoveryOrClinical: false,
  acceptedTdee: null,
  lastAcceptedCalibrationDate: null,
  calibrationAcceptedCount: 0,
  activityFullAutomation: false,
  acceptedActivityLevel: null,
  lastActivityProposalDate: null,
  heightCm: 0,
  ageYears: 0,
  sex: "male",
  activityLevel: "low",
  startDate: todayStr(),
  startWeight: 0,
  startBF: 0,
  goalWeightLow: 0,
  goalWeightHigh: 0,
  goalBFLow: 0,
  goalBFHigh: 0,
};

// Greeting is always English by design (unified brand voice), regardless
// of the app language toggle — picked randomly each time Home is opened.
const GREETINGS = [
  (name) => `Welcome, ${name}`,
  (name) => `How's your day, ${name}?`,
  (name) => `Good to see you, ${name}`,
  (name) => `Let's go, ${name}`,
  (name) => `One more step today, ${name}`,
  (name) => `Consistency wins, ${name}`,
  (name) => `Show up for yourself, ${name}`,
  (name) => `Small steps add up, ${name}`,
  (name) => `Discipline over motivation, ${name}`,
  (name) => `Keep the streak alive, ${name}`,
  (name) => `Progress, not perfection, ${name}`,
  (name) => `Back at it, ${name}`,
  (name) => `Steady hands, ${name}`,
  (name) => `Today counts too, ${name}`,
];

/* ---------------------------------------------------------
   STORAGE HELPERS
--------------------------------------------------------- */
async function loadKey(key, fallback) {
  try {
    const res = await window.storage.get(key, false);
    if (res && res.value) return JSON.parse(res.value);
    return fallback;
  } catch (e) {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), false);
    return true;
  } catch (e) {
    console.error("save failed", key, e);
    return false;
  }
}
async function deleteKey(key) {
  try {
    await window.storage.delete(key, false);
  } catch (e) {
    // ignore — key may not exist
  }
}
const STORAGE_VERSION = 4;
const ALL_STORAGE_KEYS = ["settings", "bodycomp", "workouts", "nutrition", "tdeeHistory", "customFoods", "programs", "weekPlan", "dayLogs", "guidedSessionDraft", "workoutDraft", "runSessionDraft"];
async function resetAllData() {
  await Promise.all(ALL_STORAGE_KEYS.map((k) => deleteKey(k)));
}

function migrateSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  if (!s.startDate) s.startDate = todayStr();
  if (!s.colorPalette || !PALETTES[s.colorPalette]) s.colorPalette = DEFAULT_PALETTE;
  if (!s.goalMode) s.goalMode = "cut";
  if (!s.activityLevel) s.activityLevel = "low";
  s.storageVersion = STORAGE_VERSION;
  return s;
}
function migrateWorkoutEntry(w) {
  return { exercises: [], notes: "", duration: "", distance: "", hr: "", ...w, date: w?.date || todayStr(), type: w?.type || "lift", subtype: w?.subtype || "기타" };
}
function migrateNutritionEntry(n) {
  return { meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null, ...n, date: n?.date || todayStr() };
}
function migrateBodyEntry(b) {
  return { ...b, date: b?.date || todayStr() };
}
async function runStorageMigrations() {
  const current = await loadKey("storageVersion", 0);
  if (current === STORAGE_VERSION) return;
  const settings = migrateSettings(await loadKey("settings", DEFAULT_SETTINGS));
  const workouts = (await loadKey("workouts", []) || []).map(migrateWorkoutEntry);
  const nutrition = (await loadKey("nutrition", []) || []).map(migrateNutritionEntry);
  const bodycomp = (await loadKey("bodycomp", []) || []).map(migrateBodyEntry);
  await Promise.all([
    saveKey("settings", settings),
    saveKey("workouts", workouts),
    saveKey("nutrition", nutrition),
    saveKey("bodycomp", bodycomp),
    saveKey("storageVersion", STORAGE_VERSION),
  ]);
}

// The hardware sensor reports steps *since the device's last reboot*, so
// we track our own daily baseline (the reading at the first check of the
// day) and report the difference as "today's steps". Returns:
//   null            — unavailable / no native bridge / any error
//   { denied: true } — sensor exists but permission wasn't granted
//   { steps: N }     — a valid reading
async function getTodaySteps() {
  try {
    const avail = await StepCounterPlugin.isAvailable();
    if (!avail.available) return null;
    const perm = await StepCounterPlugin.requestPermissions();
    if (!perm.granted) return { denied: true };

    let raw = null;
    for (let i = 0; i < 4; i++) {
      const res = await StepCounterPlugin.getStepsSinceBoot();
      if (res.steps >= 0) { raw = res.steps; break; }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (raw == null) return null;

    const today = todayStr();
    let baseline = await loadKey("stepBaseline", null);
    if (!baseline || baseline.date !== today || raw < baseline.value) {
      // Day rolled over (or the device rebooted) — archive the previous
      // day's final count into history before resetting the baseline, so
      // the TDEE calculation can use a trailing average of complete days
      // instead of today's still-in-progress count (see getRecentAvgSteps).
      if (baseline && baseline.date !== today && raw >= baseline.value) {
        const finalSteps = raw - baseline.value;
        const history = await loadKey("stepHistory", []);
        const updated = [...history.filter((h) => h.date !== baseline.date), { date: baseline.date, steps: finalSteps }]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 14);
        await saveKey("stepHistory", updated);
      }
      baseline = { date: today, value: raw };
      await saveKey("stepBaseline", baseline);
    }
    return { steps: Math.max(0, raw - baseline.value) };
  } catch (e) {
    return null; // not on native / plugin unavailable
  }
}

// Average of the last up-to-7 *complete* past days. Today is deliberately
// EXCLUDED — per the research on TDEE activity factors, a same-day,
// still-in-progress step count shouldn't drive that same day's calorie
// target; the multiplier is meant to reflect habitual activity, smoothed
// over about a week, not a single (possibly incomplete) day.
async function getRecentAvgSteps() {
  try {
    const history = await loadKey("stepHistory", []);
    if (!history || history.length === 0) return null;
    const recent = [...history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
    if (recent.length === 0) return null;
    return recent.reduce((s, h) => s + h.steps, 0) / recent.length;
  } catch (e) {
    return null;
  }
}

/* ---------------------------------------------------------
   SMALL UI PRIMITIVES
--------------------------------------------------------- */
function WeightSparkline({ entries, goalLow, goalHigh, heroText = "#FBFAF2" }) {
  if (!entries || entries.length < 2) return null;
  const width = 300, height = 56, padX = 4, padY = 6;
  const weights = entries.map((e) => e.weight);
  let min = Math.min(...weights);
  let max = Math.max(...weights);
  if (goalLow != null) min = Math.min(min, goalLow);
  if (goalHigh != null) max = Math.max(max, goalHigh);
  if (max === min) { max += 1; min -= 1; }
  const range = max - min;
  const n = entries.length;
  const xFor = (i) => padX + (i / (n - 1)) * (width - padX * 2);
  const yFor = (w) => padY + (1 - (w - min) / range) * (height - padY * 2);

  const linePoints = entries.map((e, i) => `${xFor(i)},${yFor(e.weight)}`).join(" ");
  const areaPoints = `${xFor(0)},${height - padY} ${linePoints} ${xFor(n - 1)},${height - padY}`;
  const lastX = xFor(n - 1);
  const lastY = yFor(entries[n - 1].weight);
  // Translucent overlays (goal band, area fill) are built from the same
  // resolved hero text color so they stay visible whether the gradient
  // needs light or dark accents (e.g. Ink Navy's bright gold gradient).
  const isLight = heroText.toUpperCase() === "#FBFAF2";
  const overlayBase = isLight ? "255,255,255" : "0,0,0";

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", marginTop: 8 }}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={width} y1={padY + f * (height - padY * 2)} y2={padY + f * (height - padY * 2)}
          stroke={`rgba(${overlayBase},0.08)`} strokeWidth="1" />
      ))}
      {goalLow != null && goalHigh != null && (
        <>
          <rect x={0} y={Math.min(yFor(goalHigh), yFor(goalLow))} width={width} height={Math.max(1, Math.abs(yFor(goalLow) - yFor(goalHigh)))} fill={`rgba(${overlayBase},0.10)`} />
          <line x1={0} x2={width} y1={yFor(goalHigh)} y2={yFor(goalHigh)} stroke={`rgba(${overlayBase},0.45)`} strokeWidth="1" strokeDasharray="3,3" />
          <line x1={0} x2={width} y1={yFor(goalLow)} y2={yFor(goalLow)} stroke={`rgba(${overlayBase},0.45)`} strokeWidth="1" strokeDasharray="3,3" />
        </>
      )}
      <polygon points={areaPoints} fill={`rgba(${overlayBase},0.16)`} />
      <polyline points={linePoints} fill="none" stroke={heroText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="3" fill={heroText} />
    </svg>
  );
}

function CornerPeel({ color, size = 28 }) {
  return (
    <div aria-hidden="true" style={{
      position: "absolute", top: -size, right: -size, width: size * 2, height: size * 2,
      borderRadius: "50%", background: color, pointerEvents: "none",
    }} />
  );
}

// A transparent, chrome-less version of Card's height-animation trick.
// Use this to wrap content that swaps between entirely different
// child components (e.g. two different tabs' worth of UI) — since Card's
// own animation only works within a single persisting Card instance, a
// bare conditional swap of two separate <Card>s (or components that each
// render their own Card) has nothing to animate between. Wrapping both
// branches in one AnimatedBox keeps a single, persistent measuring element
// so the container smoothly resizes before the new content settles in.
function AnimatedBox({ children, style }) {
  const innerRef = useRef(null);
  const [h, setH] = useState(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div style={{
      overflow: "hidden",
      height: h != null ? h : "auto",
      transition: "height 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
      ...style,
    }}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

function Card({ children, style, variant = "info", accent, ...rest }) {
  const theme = useTheme();
  const isFeature = variant === "feature";
  const isQuiet = variant === "quiet";
  const accentColor = accent || theme.ring;
  const padding = style?.padding ?? 16;
  const bg = isFeature
    ? `linear-gradient(135deg, ${tint(accentColor, theme.isDark ? 0.26 : 0.16)}, ${theme.darkPanel2 || theme.surface})`
    : (isQuiet
      ? `linear-gradient(135deg, ${theme.darkPanel2 || theme.surfaceRaised}, ${theme.darkPanel || theme.surface})`
      : `linear-gradient(135deg, ${theme.surfaceRaised}, ${theme.surface})`);
  return (
    <div
      style={{
        position: "relative",
        background: bg,
        border: `1px solid ${isFeature ? tint(accentColor, 0.42) : tint(theme.border, 0.96)}`,
        borderRadius: 18,
        padding,
        boxSizing: "border-box",
        boxShadow: theme.isDark ? `0 12px 26px rgba(0,0,0,0.32)` : `0 12px 30px ${tint(theme.text, 0.075)}`,
        overflow: "hidden",
        ...style,
      }}
      {...rest}
    >{children}</div>
  );
}


function RetroStripe({ style, height = 4 }) {
  const theme = useTheme();
  const colors = theme.stripe || [theme.act || theme.lift, theme.plan || theme.ring, theme.eat || theme.run, theme.progress || theme.run];
  return (
    <div style={{ display: "flex", gap: 3, height, width: "100%", borderRadius: 999, overflow: "hidden", ...style }}>
      {colors.map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
    </div>
  );
}

function RetroArc({ corner = "left", size = 160, style }) {
  const theme = useTheme();
  const colors = theme.stripe || [theme.act || theme.lift, theme.plan || theme.ring, theme.eat || theme.run, theme.progress || theme.run];
  return (
    <div aria-hidden="true" style={{ position: "absolute", width: size, height: size, pointerEvents: "none", opacity: theme.isDark ? 0.65 : 0.38, overflow: "hidden", ...style }}>
      {colors.map((c, i) => (
        <div key={i} style={{
          position: "absolute", inset: i * 14, borderRadius: "50%",
          border: `${10}px solid ${c}`,
          clipPath: corner === "right" ? "inset(0 0 45% 45%)" : "inset(0 45% 45% 0)",
        }} />
      ))}
    </div>
  );
}

function ScreenHeader({ eyebrow, title, subtitle, color, children }) {
  const theme = useTheme();
  const c = color || theme.ring;
  return (
    <div style={{ position: "relative", overflow: "hidden", padding: "2px 2px 3px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          {eyebrow && <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: c, marginBottom: 6 }}>{eyebrow}</div>}
          <div style={{ fontSize: 28, fontWeight: 950, letterSpacing: "-0.04em", lineHeight: 1.0, color: theme.text, textTransform: "none" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: theme.textDim, marginTop: 8, lineHeight: 1.45 }}>{subtitle}</div>}
        </div>
        {children}
      </div>
      <RetroStripe style={{ marginTop: 12, maxWidth: 236, boxShadow: `0 0 0 1px ${tint(c, 0.16)}` }} height={5} />
    </div>
  );
}

function CassetteFooter() {
  return null;
}

function MiniBarSpark({ color }) {
  const theme = useTheme();
  const vals = [0.22, 0.38, 0.52, 0.45, 0.66, 0.82, 0.58];
  return <div style={{ height: 34, display: "flex", alignItems: "flex-end", gap: 3, marginTop: 8 }}>
    {vals.map((v, i) => <span key={i} style={{ flex: 1, height: `${v * 100}%`, minHeight: 4, borderRadius: 4, background: tint(color, theme.isDark ? 0.75 : 0.85) }} />)}
  </div>;
}

function ProgressLine({ value = 0, color, style }) {
  const theme = useTheme();
  return <div style={{ height: 7, borderRadius: 999, background: tint(theme.text, theme.isDark ? 0.16 : 0.09), overflow: "hidden", ...style }}>
    <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, borderRadius: 999, background: `linear-gradient(90deg, ${color || theme.ring}, ${theme.plan || theme.run})` }} />
  </div>;
}

function SectionLabel({ children, right }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "8px 2px 10px" }}>
      <div style={{ fontSize: 15, lineHeight: 1.25, fontWeight: 750, letterSpacing: "-0.02em", color: theme.text }}>{children}</div>
      {right}
    </div>
  );
}

function StatusCallout({ tone = "info", children, style }) {
  const theme = useTheme();
  const color = tone === "danger" ? theme.danger : tone === "run" ? theme.run : tone === "lift" ? theme.lift : theme.ring;
  return (
    <div style={{ border: `1px solid ${tint(color, 0.38)}`, background: `linear-gradient(135deg, ${tint(color, 0.16)}, ${theme.darkPanel || theme.surface})`, borderRadius: 14, padding: "11px 12px", color: theme.text, fontSize: 13, lineHeight: 1.5, ...style }}>{children}</div>
  );
}

function InsightLine({ children }) {
  const theme = useTheme();
  return <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8, marginTop: 10, color: theme.textDim, fontSize: 13, lineHeight: 1.45 }}>{children}</div>;
}

function Field({ label, children }) {
  const theme = useTheme();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: theme.textDim }}>
      {label}
      {children}
    </label>
  );
}

const getInputStyle = (theme) => ({
  background: theme.isDark ? (theme.darkPanel || theme.surfaceRaised) : "#FFF9EC",
  border: `1px solid ${tint(theme.border, theme.isDark ? 1 : 0.9)}`,
  borderRadius: 12,
  padding: "12px 12px",
  color: theme.text,
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  boxShadow: theme.isDark ? "inset 0 1px 0 rgba(255,255,255,0.03)" : "none",
});

function TextInput(props) {
  const theme = useTheme();
  const inputMode = props.inputMode || (props.type === "number" ? "decimal" : undefined);
  return <input {...props} inputMode={inputMode} style={{ ...getInputStyle(theme), ...(props.style || {}) }} />;
}
function UnitInput({ unit, style, ...props }) {
  const theme = useTheme();
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <TextInput {...props} style={{ paddingRight: unit ? 48 : undefined, ...(style || {}) }} />
      {unit && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: theme.textFaint, pointerEvents: "none", fontWeight: 700 }}>{unit}</span>}
    </div>
  );
}
function Select({ children, value, onChange, style, disabled, placeholder, ...props }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const buttonRef = useRef(null);

  const options = React.Children.toArray(children)
    .filter(Boolean)
    .map((child) => {
      if (!React.isValidElement(child)) return null;
      return {
        value: child.props.value ?? child.props.children,
        label: child.props.children,
        disabled: child.props.disabled,
      };
    })
    .filter(Boolean);

  const selected = options.find((opt) => String(opt.value) === String(value));
  const label = selected?.label ?? placeholder ?? "Select";

  const close = () => setOpen(false);
  const openMenu = () => {
    if (disabled) return;
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
    setOpen(true);
  };
  const choose = (opt) => {
    if (opt.disabled) return;
    onChange?.({ target: { value: opt.value, name: props.name } });
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    const onResize = () => close();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [open]);

  const base = getInputStyle(theme);
  const menu = open && rect ? createPortal(
    <div
      data-no-tab-swipe="true"
      role="presentation"
      onMouseDown={(e) => e.preventDefault()}
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        background: "rgba(0,0,0,0.26)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        role="listbox"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: Math.max(10, Math.min(rect.left, window.innerWidth - rect.width - 10)),
          top: Math.min(rect.bottom + 6, window.innerHeight - Math.min(320, options.length * 46 + 16) - 10),
          width: Math.max(rect.width, 190),
          maxHeight: 320,
          overflowY: "auto",
          background: `linear-gradient(180deg, ${theme.darkPanel2 || theme.surfaceRaised}, ${theme.darkPanel || theme.surface})`,
          border: `1px solid ${tint(theme.ring, 0.34)}`,
          borderRadius: 14,
          boxShadow: "0 18px 46px rgba(0,0,0,0.45)",
          padding: 6,
          boxSizing: "border-box",
        }}
      >
        {options.map((opt, idx) => {
          const active = String(opt.value) === String(value);
          return (
            <button
              key={`${opt.value}-${idx}`}
              type="button"
              role="option"
              aria-selected={active}
              disabled={opt.disabled}
              onClick={() => choose(opt)}
              style={{
                width: "100%",
                minHeight: 42,
                border: `1px solid ${active ? tint(theme.ring, 0.42) : "transparent"}`,
                borderRadius: 11,
                background: active ? `linear-gradient(135deg, ${tint(theme.ring, 0.20)}, ${theme.darkPanel2 || theme.surfaceRaised})` : "transparent",
                color: active ? theme.ring : theme.text,
                opacity: opt.disabled ? 0.45 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "9px 10px",
                textAlign: "left",
                fontSize: 13,
                fontWeight: active ? 850 : 650,
                cursor: opt.disabled ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
              {active && <Check size={14} color={theme.ring} />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        {...props}
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={openMenu}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          ...base,
          ...(style || {}),
          minHeight: style?.minHeight ?? 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          paddingRight: 12,
          WebkitAppearance: "none",
          appearance: "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <ChevronDown size={15} color={theme.textFaint} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.16s ease" }} />
      </button>
      {menu}
    </>
  );
}

function PrimaryButton({ children, onClick, style, disabled }) {
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={release}
      onTouchCancel={release}
      style={{
        background: `linear-gradient(135deg, ${theme.gradA}, ${theme.gradB})`,
        color: theme.heroText || "#15120E",
        border: `1px solid ${tint(theme.gradB, 0.42)}`,
        borderRadius: 14,
        minHeight: 50,
        padding: "12px 18px",
        fontSize: 14,
        fontWeight: 850,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        width: "100%",
        transform: pressed ? "scale(0.97)" : "scale(1)",
        transition: "transform 0.12s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function IconBtn({ onClick, children, danger, label }) {
  const theme = useTheme();
  const { t } = useLang();
  return (
    <button
      onClick={onClick}
      aria-label={label || (danger ? t("삭제", "Delete") : t("작업", "Action"))}
      style={{
        background: "transparent",
        border: "none",
        color: danger ? theme.danger : theme.textDim,
        cursor: "pointer",
        padding: 8,
        minWidth: 40,
        minHeight: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function SectionTitle({ children, right }) {
  return <SectionLabel right={right}>{children}</SectionLabel>;
}

/* ---------------------------------------------------------
   DASHBOARD
--------------------------------------------------------- */
function ProgressRing({ pct, size = 128, stroke = 10, color, trackColor, label, sub }) {
  const theme = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c - (c * clamped) / 100}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums", fontFamily: FONT_STACK }}>
          {Math.round(clamped)}%
        </div>
        <div style={{ fontSize: 12, color: theme.textDim, marginTop: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: theme.textFaint }}>{sub}</div>}
      </div>
    </div>
  );
}


function getLatestBodyComp(bodycomp, settings = {}) {
  const sorted = [...(bodycomp || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const latest = sorted[sorted.length - 1] || null;
  return {
    latest,
    weight: latest?.weight ?? settings.startWeight ?? null,
    bodyfat: latest?.bodyfat ?? settings.startBF ?? null,
  };
}

function MiniMetric({ label, value, sub, color, icon, onClick, spark = false }) {
  const theme = useTheme();
  const c = color || theme.ring;
  const dark = theme.heroText || "#17120E";
  const muted = theme.heroTextDim || "#5F4933";
  const content = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 7 }}>
        <span style={{ color: muted, fontSize: 11.5, fontWeight: 850, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
        {icon && <span style={{ width: 28, height: 28, borderRadius: 999, background: tint(c, 0.18), color: c, display: "grid", placeItems: "center", border: `1px solid ${tint(c, 0.28)}` }}>{icon}</span>}
      </div>
      <div style={{ color: dark, fontSize: 22, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ color: muted, fontSize: 11, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      {spark && <MiniBarSpark color={c} />}
    </>
  );
  const common = { flex: 1, minWidth: 0, background: `linear-gradient(180deg, ${theme.cream2 || '#F8EFD8'}, ${theme.cream || '#F3E9D2'})`, border: `1px solid ${tint(c, 0.28)}`, borderRadius: 16, padding: "11px 10px 10px", boxShadow: "0 8px 18px rgba(0,0,0,0.16)", boxSizing: "border-box" };
  if (onClick) {
    return <button onClick={onClick} style={{ ...common, textAlign: "left", cursor: "pointer", color: dark }}>{content}</button>;
  }
  return <div style={common}>{content}</div>;
}

function IntentCard({ title, body, color, icon, onClick }) {
  const theme = useTheme();
  const darkText = theme.isDark ? theme.text : "#102033";
  return (
    <button onClick={onClick} style={{ width: "100%", border: `1px solid ${tint(color, 0.42)}`, background: `linear-gradient(135deg, ${tint(color, theme.isDark ? 0.24 : 0.76)}, ${theme.darkPanel || tint(color, 0.52)})`, borderRadius: 18, padding: "15px 16px", textAlign: "left", cursor: "pointer", color: theme.text, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, minHeight: 86, boxShadow: theme.isDark ? `0 12px 26px rgba(0,0,0,0.25)` : `0 10px 24px ${tint(color, 0.18)}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 19, fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: theme.isDark ? theme.textDim : tint("#102033", 0.72), marginTop: 5, lineHeight: 1.35 }}>{body}</div>
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 15, background: tint("#FFFFFF", 0.66), color, display: "grid", placeItems: "center", flexShrink: 0 }}>{icon}</div>
    </button>
  );
}

function TodayTab({ settings, bodycomp, recentAvgSteps, currentSteps, stepTrackingEnabled, goToTab, openActView, workouts, nutrition, dayLogs }) {
  const { t } = useLang();
  const theme = useTheme();
  const { weight, bodyfat } = getLatestBodyComp(bodycomp, settings);
  const engine = estimateTdeeEngine(settings, bodycomp, nutrition, workouts, weight, recentAvgSteps);
  const effectiveTdee = settings.acceptedTdee ?? engine?.effectiveTdee ?? null;
  const activeTarget = effectiveTdee ? computeActiveTarget(settings, effectiveTdee, weight, bodyfat) : null;
  const target = activeTarget?.target ?? null;
  const goalLabel = settings.goalMode === "gain" ? t("증량", "Gain") : settings.goalMode === "maintain" ? t("유지", "Maintain") : t("감량", "Cut");
  const [stepsOpen, setStepsOpen] = useState(false);
  const stepsValue = currentSteps != null ? Math.round(currentSteps).toLocaleString() : "—";
  const avgStepsLabel = recentAvgSteps != null ? Math.round(recentAvgSteps).toLocaleString() : t("데이터 없음", "No data yet");
  const actColor = theme.act || "#F76B55";
  const eatColor = theme.eat || "#8DAE7F";
  const planColor = theme.plan || "#F5B942";
  const progressColor = theme.progress || "#6EA7D6";
  const displayName = settings.userName && settings.userName !== "USERNAME" ? settings.userName : "Jinwoo";
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)](displayName));

  const today = todayStr();
  const loggedWorkout = workouts.some((w) => w.date === today);
  const loggedMeal = nutrition.some((n) => n.date === today);
  const loggedCheckin = dayLogs.some((d) => d.date === today);
  const mealsToday = nutrition.filter((n) => n.date === today);
  const calsToday = mealsToday.reduce((s, n) => s + (+n.calories || 0), 0);

  const statusItems = [
    { done: loggedWorkout, label: t("오늘 운동 기록", "Workout logged today"), action: () => openActView("training"), color: actColor },
    { done: loggedMeal, label: loggedMeal ? t(`오늘 ${mealsToday.length}끼 · ${Math.round(calsToday)}kcal`, `${mealsToday.length} meals · ${Math.round(calsToday)}kcal today`) : t("아직 식사 기록 없음", "No meals logged yet"), action: () => goToTab("eat"), color: eatColor },
    { done: loggedCheckin, label: t("오늘 체크인 완료", "Check-in complete"), action: () => openActView("checkin"), color: planColor },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {stepTrackingEnabled && stepsOpen && (
        <ConfirmDialog
          message={t(`오늘 걸음수: ${stepsValue}보\n최근 7일 평균: ${avgStepsLabel}보`, `Today's steps: ${stepsValue}\nRecent 7-day average: ${avgStepsLabel}`)}
          onConfirm={() => setStepsOpen(false)}
          onCancel={() => setStepsOpen(false)}
          confirmLabel={t("확인", "OK")}
          hideCancel
          tone="neutral"
        />
      )}
      <ScreenHeader
        eyebrow={t("오늘", "Today")}
        title={greeting}
        subtitle={t("오늘 상태를 확인하고 바로 기록하세요.", "Check today, then log what matters.")}
        color={actColor}
      />
      {stepTrackingEnabled && (
        <button onClick={() => setStepsOpen(true)} style={{ width: "100%", border: `1px solid ${tint(progressColor, 0.34)}`, background: `linear-gradient(135deg, ${tint(progressColor, theme.isDark ? 0.26 : 0.20)}, ${theme.surface})`, borderRadius: 22, padding: 15, textAlign: "left", cursor: "pointer", color: theme.text, boxShadow: theme.isDark ? `0 12px 28px ${tint("#000", 0.16)}` : `0 12px 28px ${tint(progressColor, 0.13)}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Footprints size={17} color={actColor} />
              <span style={{ fontSize: 12, fontWeight: 800, color: theme.textDim, letterSpacing: "0.04em", textTransform: "uppercase" }}>{t("오늘 걸음", "Today's Steps")}</span>
            </div>
            <ChevronRight size={15} color={theme.textFaint} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 850, color: theme.text, fontVariantNumeric: "tabular-nums" }}>{stepsValue}</span>
            <span style={{ fontSize: 12, color: theme.textDim }}>{t("걸음", "steps")}</span>
          </div>
          {currentSteps != null && <div style={{ fontSize: 11.5, color: theme.textDim, marginTop: 4 }}>{Math.round(currentSteps).toLocaleString()} / 10,000 · {Math.min(100, Math.round((currentSteps/10000)*100))}%</div>}
          {currentSteps != null && <StepAchievementBar steps={Math.round(currentSteps)} />}
        </button>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <MiniMetric onClick={() => openActView("body")} label={t("몸", "Body")} value={weight ? `${Number(weight).toFixed(1)}kg` : "—"} sub={bodyfat ? `${t("체지방", "Body fat")} ${Math.round(bodyfat)}%` : t("현재 체중", "Current weight")} color={actColor} icon={<Scale size={15} />} />
        <MiniMetric onClick={() => goToTab("plan")} label={t("목표", "Goal")} value={goalLabel} sub={t("현재 모드", "current mode")} color={planColor} icon={<Award size={15} />} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 2 }}>
        <div style={{ fontSize: 12, color: theme.textFaint, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase" }}>{t("무엇을 하시나요?", "What are you doing?")}</div>
        <IntentCard title="Act" body={t("운동, 활동, 체성분, 체크인을 기록합니다.", "Log training, activity, body updates or check-ins.")} color={actColor} icon={<Activity size={22} />} onClick={() => goToTab("act", { reset: true })} />
        <IntentCard title="Eat" body={t("식사, 간식, 수분, 영양을 기록합니다.", "Log meals, snacks, water and nutrition.")} color={eatColor} icon={<Utensils size={22} />} onClick={() => goToTab("eat", { reset: true })} />
        <IntentCard title="Plan" body={t("목표, 칼로리, 운동 계획, 주간 타깃을 조정합니다.", "Adjust goals, calories, programs and weekly targets.")} color={planColor} icon={<Clock size={22} />} onClick={() => goToTab("plan", { reset: true })} />
      </div>
      <Card variant="feature" accent={eatColor}>
        <SectionTitle>{t("오늘 스냅샷", "Today's Snapshot")}</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "82px 1fr", gap: 14, alignItems: "center" }}>
          <div style={{ width: 72, height: 72, borderRadius: 999, background: `conic-gradient(${actColor} 0 38%, ${eatColor} 38% 68%, ${planColor} 68% 84%, ${tint(theme.text, theme.isDark ? 0.18 : 0.10)} 84% 100%)`, display: "grid", placeItems: "center" }}>
            <div style={{ width: 46, height: 46, borderRadius: 999, background: theme.surface }} />
          </div>
          <div>
            <div style={{ fontSize: 23, fontWeight: 900, color: theme.text }}>{Math.round(calsToday || 0).toLocaleString()} <span style={{ fontSize: 12, color: theme.textDim, fontWeight: 700 }}>kcal</span></div>
            <div style={{ marginTop: 9, display: "grid", gap: 6 }}>
              <ProgressLine value={Math.min(100, (calsToday / Math.max(1, target)) * 100)} color={actColor} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: theme.textDim }}>
                <span>{t("음식", "Food")}</span><span>{Math.round(calsToday || 0)} / {Math.round(target || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
      <Card variant="quiet">
        <SectionTitle>{t("오늘 체크리스트", "Today's Checklist")}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {statusItems.map((item, i) => (
            <button key={i} onClick={item.action} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
              padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${theme.border}`,
              background: "none", border: "none", cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 9, flexShrink: 0,
                  background: item.done ? item.color : "transparent",
                  border: `1.5px solid ${item.done ? item.color : theme.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {item.done && <Check size={11} color="#FFFFFF" />}
                </div>
                <span style={{ fontSize: 13, color: theme.text }}>{item.label}</span>
              </div>
              <ChevronRight size={15} color={theme.textFaint} />
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ActionTile({ title, body, icon, color, onClick }) {
  const theme = useTheme();
  const dark = theme.heroText || "#17120E";
  const muted = theme.heroTextDim || "#5F4933";
  return (
    <button onClick={onClick} style={{ border: `1px solid ${tint(color, 0.32)}`, background: `linear-gradient(180deg, ${theme.cream2 || '#F8EFD8'}, ${theme.cream || '#F3E9D2'})`, borderRadius: 18, padding: 14, minHeight: 112, cursor: "pointer", color: dark, textAlign: "left", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12, boxShadow: "0 10px 22px rgba(0,0,0,0.16)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, background: color, opacity: 0.95 }} />
      <div style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: tint(color, 0.16), color: color, border: `1px solid ${tint(color, 0.28)}` }}>{icon}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 900 }}>{title}</div>
        <div style={{ fontSize: 12, color: muted, marginTop: 4, lineHeight: 1.35 }}>{body}</div>
      </div>
    </button>
  );
}

function ActTab({ workouts, setWorkouts, programs, bodycomp, setBodycomp, dayLogs, setDayLogs, initialView, onConsumedInitialView, resetSignal, onViewChange, currentSteps, stepTrackingEnabled }) {
  const { t } = useLang();
  const theme = useTheme();
  const [view, setView] = useState("overview");
  const [editWorkoutId, setEditWorkoutId] = useState(null);
  const [editWorkoutSignal, setEditWorkoutSignal] = useState(0);
  const [showAllDayLogs, setShowAllDayLogs] = useState(false);

  const openView = (next) => {
    if (next && next !== "overview") {
      try { window.history.pushState({ hlActView: next }, "", window.location.href); } catch (e) { /* ignore */ }
    }
    setView(next || "overview");
  };
  const closeView = () => setView("overview");
  const openWorkoutEdit = (entry) => {
    setEditWorkoutId(entry.id);
    setEditWorkoutSignal((v) => v + 1);
    openView(entry.type === "run" ? "cardio" : "training");
  };

  useEffect(() => {
    if (onViewChange) onViewChange(view);
  }, [view, onViewChange]);

  useEffect(() => {
    if (!initialView) return;
    openView(initialView);
    if (onConsumedInitialView) onConsumedInitialView();
  }, [initialView]);

  useEffect(() => {
    setView("overview");
    setEditWorkoutId(null);
    setEditWorkoutSignal((v) => v + 1);
    setShowAllDayLogs(false);
  }, [resetSignal]);

  useEffect(() => {
    const onPopState = () => {
      if (view !== "overview") setView("overview");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view]);

  const BackBtn = () => <button onClick={closeView} style={{ alignSelf: "flex-start", background: "transparent", border: "none", color: theme.ring, fontSize: 13, fontWeight: 700 }}>← {t("Act", "Act")}</button>;
  if (view === "training") return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><BackBtn /><WorkoutsTab workouts={workouts} setWorkouts={setWorkouts} programs={programs} initialEditId={editWorkoutId} editSignal={editWorkoutSignal} /></div>;
  if (view === "cardio") return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><BackBtn /><WorkoutsTab workouts={workouts} setWorkouts={setWorkouts} programs={programs} initialMode="run" initialEditId={editWorkoutId} editSignal={editWorkoutSignal} /></div>;
  if (view === "body") return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><BackBtn /><BodyCompTab bodycomp={bodycomp} setBodycomp={setBodycomp} /></div>;
  if (view === "checkin") return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><BackBtn /><DayLogCard dayLogs={dayLogs} setDayLogs={setDayLogs} /></div>;
  const recentActivities = [...workouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const sortedDayLogs = [...dayLogs].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const visibleDayLogs = showAllDayLogs ? sortedDayLogs : sortedDayLogs.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ScreenHeader
        eyebrow="ACT"
        title={t("ACT", "ACT")}
        subtitle={t("Move your body.", "Move your body.")}
        color={theme.act || theme.lift}
      />
      {stepTrackingEnabled && (
        <Card variant="feature" accent={theme.act || theme.lift} style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 850, color: theme.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t("걸음 진행도", "Step Progress")}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: theme.text, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{currentSteps != null ? Math.round(currentSteps).toLocaleString() : '—'} <span style={{ fontSize: 12, color: theme.textDim }}>{t("/ 10,000 걸음", "/ 10,000 steps")}</span></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 900, color: theme.act || theme.lift }}>{currentSteps != null ? `${Math.min(100, Math.round((currentSteps/10000)*100))}%` : '—'}</div>
          </div>
          {currentSteps != null && <StepAchievementBar steps={Math.round(currentSteps)} />}
        </Card>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <ActionTile title="Training" body={t("근력 운동과 가이드 세션", "Strength workouts and guided sessions")} color={theme.act || "#F76B55"} icon={<Dumbbell size={20} />} onClick={() => openView("training")} />
        <ActionTile title="Cardio" body={t("러닝, 걷기, 유산소 기록", "Runs, walks and cardio logs")} color={theme.progress || "#6EA7D6"} icon={<Activity size={20} />} onClick={() => openView("cardio")} />
        <ActionTile title="Body Update" body={t("체중, 체지방, 신체 치수", "Weight, body fat and measurements")} color={theme.plan || "#F5B942"} icon={<Scale size={20} />} onClick={() => openView("body")} />
        <ActionTile title="Check-in" body={t("에너지, 수면, 컨디션", "Energy, sleep and recovery notes")} color={theme.checkin || "#A88BD8"} icon={<Smile size={20} />} onClick={() => openView("checkin")} />
      </div>
      <Card variant="quiet" accent={theme.checkin || "#A88BD8"}>
        <SectionTitle right={sortedDayLogs.length > 4 ? (
          <button onClick={() => setShowAllDayLogs(!showAllDayLogs)} style={{ background: "none", border: "none", color: theme.checkin || theme.ring, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            {showAllDayLogs ? t("접기", "Collapse") : t("더 보기", "View all")}
          </button>
        ) : null}>{t("데일리 로그", "Daily Log")}</SectionTitle>
        {visibleDayLogs.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleDayLogs.map((d) => (
              <button key={d.id} onClick={() => openView("checkin")} style={{ width: "100%", textAlign: "left", background: tint(theme.checkin || theme.ring, theme.isDark ? 0.12 : 0.08), border: `1px solid ${tint(theme.checkin || theme.ring, 0.22)}`, borderRadius: 14, padding: "10px 12px", color: theme.text, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 850 }}>{fmtDate(d.date)}</span>
                  <span style={{ fontSize: 11.5, color: theme.textDim, fontVariantNumeric: "tabular-nums" }}>
                    {t("기분", "Mood")} {d.mood || "—"} · {t("에너지", "Energy")} {d.energy || "—"} · {t("수면", "Sleep")} {d.sleep || "—"}
                  </span>
                </div>
                {d.note && <div style={{ fontSize: 12.5, color: theme.textDim, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{d.note}</div>}
              </button>
            ))}
          </div>
        ) : (
          <EmptyState text={t("아직 데일리 로그가 없습니다.", "No daily logs yet.")} actionLabel={t("체크인 작성", "Write check-in")} onAction={() => openView("checkin")} />
        )}
      </Card>

      <Card variant="quiet" accent={theme.act || theme.lift}>
        <SectionTitle>{t("최근 활동", "Recent Activity")}</SectionTitle>
        {recentActivities.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recentActivities.map((w) => {
              const accent = w.type === "lift" ? theme.lift : theme.run;
              return (
              <button key={w.id} onClick={() => openWorkoutEdit(w)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 12px", border: `1px solid ${tint(accent, 0.22)}`, borderRadius: 14, background: `linear-gradient(135deg, ${tint(accent, 0.12)}, ${theme.darkPanel2 || theme.surface})`, color: theme.text, cursor: "pointer", textAlign: "left", boxShadow: "0 8px 18px rgba(0,0,0,0.14)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 10, background: tint(accent, 0.14), border: `1px solid ${tint(accent,0.25)}`, display: "grid", placeItems: "center", flexShrink: 0 }}>{w.type === "lift" ? <Dumbbell size={15} color={accent} /> : <Activity size={15} color={accent} />}</span>
                  <span style={{ minWidth: 0 }}><span style={{ fontWeight: 800, display: 'block' }}>{w.subtype || w.type}</span><span style={{ fontSize: 12, color: theme.textDim }}>{fmtDate(w.date)}</span></span>
                </div>
                <span style={{ display: 'flex', alignItems:'center', gap:6, color: theme.textFaint, fontSize: 12 }}><Pencil size={12} color={theme.textFaint} />{t("수정", "Edit")}</span>
              </button>
            )})}
          </div>
        ) : <EmptyState text={t("아직 활동 기록이 없어요.", "No activity logged yet.")} />}
      </Card>
      {workouts.length > 0 && <MuscleGroupBreakdown workouts={workouts} />}
    </div>
  );
}

function PlanTab({ settings, onSaveSettings, bodycomp, nutrition, workouts, programs, weekPlan, setWeekPlan, setPrograms, recentAvgSteps, tdeeHistory, setTdeeHistory, resetSignal }) {
  const { lang, t } = useLang();
  const theme = useTheme();
  const { weight, bodyfat } = getLatestBodyComp(bodycomp, settings);
  const engine = estimateTdeeEngine(settings, bodycomp, nutrition, workouts, weight, recentAvgSteps);
  const effectiveTdee = settings.acceptedTdee ?? engine?.effectiveTdee ?? null;
  const roundedTdee = effectiveTdee ? Math.round(effectiveTdee / 10) * 10 : null;
  const GoalButton = ({ mode, label }) => {
    const activeMode = settings.goalMode === mode;
    return <button onClick={() => onSaveSettings({ ...settings, goalMode: mode })} style={{ flex: 1, minHeight: 48, borderRadius: 14, border: `1px solid ${activeMode ? theme.plan || theme.ring : theme.border}`, background: activeMode ? `linear-gradient(135deg, ${tint(theme.plan || theme.ring, 0.22)}, ${theme.darkPanel2 || theme.surface})` : theme.surface, color: activeMode ? theme.plan || theme.ring : theme.text, fontWeight: 900, letterSpacing: '0.02em' }}>{label}</button>;
  };

  // This week's plan completion — same logic the old Dashboard used, now
  // actually reachable from the tab that's supposed to own "planning."
  const now = nowDate();
  const dow = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((dow + 6) % 7));
  startOfWeek.setHours(0, 0, 0, 0);
  const weekDates = weekPlan.map((_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return localDateStr(d);
  });
  const doneMap = {};
  workouts.forEach((w) => {
    const idx = weekDates.indexOf(w.date);
    if (idx >= 0) doneMap[idx] = true;
  });
  const todayIdx = (dow + 6) % 7;
  const [editingDayIdx, setEditingDayIdx] = useState(null);
  const [showHealthContext, setShowHealthContext] = useState(!!(settings.pregnantOrBreastfeeding || settings.edRecoveryOrClinical));

  useEffect(() => {
    setEditingDayIdx(null);
    setShowHealthContext(!!(settings.pregnantOrBreastfeeding || settings.edRecoveryOrClinical));
  }, [resetSignal]);

  const healthActive = !!(settings.pregnantOrBreastfeeding || settings.edRecoveryOrClinical);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ScreenHeader
        eyebrow={t("계획", "Plan")}
        title={t("PLAN", "PLAN")}
        subtitle={t("Organize your day.", "Organize your day.")}
        color={theme.plan || theme.ring}
      />
      <Card variant="feature" accent={theme.plan || theme.ring}><SectionTitle>{t("목표", "Goal")}</SectionTitle><div style={{ display: "flex", gap: 8 }}><GoalButton mode="cut" label={t("감량", "Cut")} /><GoalButton mode="maintain" label={t("유지", "Maintain")} /><GoalButton mode="gain" label={t("증량", "Gain")} /></div></Card>

      <Card variant="quiet" accent={healthActive ? theme.danger : (theme.eat || theme.lift)}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: theme.text }}>{t("건강 예외", "Health Context")}</div>
            <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 3 }}>
              {healthActive ? t("건강 예외가 적용 중입니다.", "Health context is active.") : t("기본값: 꺼짐. 필요할 때만 켜세요.", "Default: off. Turn on only if needed.")}
            </div>
          </div>
          <button
            onClick={() => setShowHealthContext(!showHealthContext)}
            style={{ width: 48, height: 28, borderRadius: 999, border: "none", background: showHealthContext ? (theme.eat || theme.lift) : theme.surfaceRaised, position: "relative", cursor: "pointer", flexShrink: 0 }}
          >
            <span style={{ position: "absolute", top: 4, left: showHealthContext ? 24 : 4, width: 20, height: 20, borderRadius: 999, background: theme.surface, transition: "left 0.2s ease", boxShadow: `0 2px 8px ${tint("#000", 0.18)}` }} />
          </button>
        </div>
        {showHealthContext && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.border}` }}>
            <button onClick={() => onSaveSettings({ ...settings, pregnantOrBreastfeeding: !settings.pregnantOrBreastfeeding })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, border: `1px solid ${settings.pregnantOrBreastfeeding ? theme.danger : theme.border}`, background: settings.pregnantOrBreastfeeding ? tint(theme.danger, 0.10) : theme.surface, color: theme.text, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{t("임신/수유 중", "Pregnant or breastfeeding")}</span>
              <span style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${settings.pregnantOrBreastfeeding ? theme.danger : theme.border}`, background: settings.pregnantOrBreastfeeding ? theme.danger : "transparent", display: "grid", placeItems: "center" }}>{settings.pregnantOrBreastfeeding && <Check size={12} color="#fff" />}</span>
            </button>
            <button onClick={() => onSaveSettings({ ...settings, edRecoveryOrClinical: !settings.edRecoveryOrClinical })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, border: `1px solid ${settings.edRecoveryOrClinical ? theme.danger : theme.border}`, background: settings.edRecoveryOrClinical ? tint(theme.danger, 0.10) : theme.surface, color: theme.text, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{t("식이장애 회복/임상 관리 중", "ED recovery or clinical supervision")}</span>
              <span style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${settings.edRecoveryOrClinical ? theme.danger : theme.border}`, background: settings.edRecoveryOrClinical ? theme.danger : "transparent", display: "grid", placeItems: "center" }}>{settings.edRecoveryOrClinical && <Check size={12} color="#fff" />}</span>
            </button>
          </div>
        )}
      </Card>

      {roundedTdee && weight ? (
        <Card variant="feature" accent={theme.act || theme.lift}>
          <SectionTitle>{t("칼로리 전략", "Calorie Strategy")}</SectionTitle>
          <GoalTargetsPanel
            settings={settings}
            onSaveSettings={onSaveSettings}
            effectiveTdee={roundedTdee}
            currentWeight={weight}
            currentBF={bodyfat}
            weekPlan={weekPlan}
          />
        </Card>
      ) : (
        <Card variant="feature" accent={theme.act || theme.lift}><SectionTitle>{t("칼로리 전략", "Calorie Strategy")}</SectionTitle><InsightLine>{t("신체 정보가 충분하면 목표 칼로리가 표시됩니다.", "Add body data to show a calorie target.")}</InsightLine></Card>
      )}

      <Card variant="quiet" accent={theme.progress || theme.run}>
        <SectionTitle right={<span style={{ fontSize: 12, color: theme.textFaint }}>{t("요일 탭해서 수정", "Tap a day to edit")}</span>}>{t("운동 계획", "Training Plan")}</SectionTitle>
        <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
          {weekPlan.map((d, i) => {
            const isToday = i === todayIdx;
            const done = doneMap[i];
            const color = d.kind === "lift" ? theme.lift : d.kind === "run" ? theme.run : theme.rest;
            const label = d.kind === "lift" ? (programs.find((p) => p.id === d.programId)?.name || "?") : d.kind === "run" ? (d.runLabel === "S.R" ? "Short" : d.runLabel === "L.R" ? "Long" : (d.runLabel || t("런", "Run"))) : "Rest";
            return (
              <button key={i} onClick={() => setEditingDayIdx(editingDayIdx === i ? null : i)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                <div style={{ fontSize: 12, color: isToday ? theme.text : theme.textFaint, fontWeight: isToday ? 700 : 500 }}>{WEEKDAY_LABELS[lang][i]}</div>
                <div style={{
                  width: "100%", aspectRatio: "1", borderRadius: 12,
                  background: done ? color : "transparent",
                  border: `1.5px solid ${editingDayIdx === i ? theme.text : color}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: isToday ? `0 0 0 2px ${theme.bg}, 0 0 0 3px ${color}` : "none",
                }}>
                  {done ? <Check size={13} color={d.kind === "lift" ? theme.heroText : "#FBFAF2"} /> : (d.kind === "lift" ? <Dumbbell size={13} color={color} /> : d.kind === "run" ? <Activity size={13} color={color} /> : null)}
                </div>
                <div style={{ fontSize: 12, color: theme.textFaint, textAlign: "center" }}>{label}</div>
              </button>
            );
          })}
        </div>
      </Card>
      {editingDayIdx !== null && (
        <DayEditorPanel
          dayIdx={editingDayIdx}
          weekPlan={weekPlan}
          setWeekPlan={setWeekPlan}
          programs={programs}
          setPrograms={setPrograms}
          onClose={() => setEditingDayIdx(null)}
        />
      )}

      <Card variant="quiet" accent={theme.eat || theme.lift}><SectionTitle>{t("주간 타깃", "Weekly Targets")}</SectionTitle>{[{label:t("운동", "Workouts"), value:`${weekPlan.filter(d=>d.kind!=="rest").length} / 7`},{label:t("단백질", "Protein"), value: roundedTdee ? `${macrosFor(roundedTdee, weight, settings.sex, bodyfat, settings.carbPercent).proteinG}g` : "—"},{label:t("걸음", "Steps"), value: recentAvgSteps ? Math.round(recentAvgSteps).toLocaleString() : "—"}].map((row)=><div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0", borderTop:`1px solid ${theme.border}`, fontSize:13 }}><span style={{ color: theme.textDim }}>{row.label}</span><span style={{ fontWeight:800 }}>{row.value}</span></div>)}</Card>
    </div>
  );
}

function SettingsSheet({ open, onClose, children }) {
  const theme = useTheme();
  if (!open) return null;
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: tint("#000000", 0.28), display: "flex", justifyContent: "center", alignItems: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", background: theme.bg, color: theme.text, borderRadius: "24px 24px 0 0", border: `1px solid ${theme.border}`, padding: "18px 18px calc(18px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}><div style={{ fontSize: 20, fontWeight: 850 }}>Settings</div><IconBtn onClick={onClose} label="Close"><X size={20} /></IconBtn></div>
        {children}
      </div>
    </div>, document.body
  );
}

// Shared step-count achievement tiers.
const STEP_TIERS = [
  { id: "low", threshold: 4000, label: (t) => t("적음", "Low") },
  { id: "moderate", threshold: 8000, label: (t) => t("보통", "Moderate") },
  { id: "high", threshold: 12000, label: (t) => t("많음", "High") },
];

function StepAchievementBar({ steps }) {
  const { t } = useLang();
  const theme = useTheme();
  const max = 10000;
  const pct = Math.min(100, (steps / max) * 100);
  const marks = [2500, 5000, 7500];
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: "relative", height: 10, borderRadius: 999, background: tint(theme.text, 0.12), overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 999, transition: "width 0.3s ease",
          background: `linear-gradient(90deg, ${theme.mustard || theme.lift}, ${theme.rust || theme.plan}, ${theme.teal || theme.progress})`,
        }} />
        {marks.map((m) => (
          <div key={m} aria-hidden="true" style={{
            position: "absolute", top: 0, bottom: 0, left: `${(m / max) * 100}%`,
            width: 1, background: tint('#000000', 0.18),
          }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, color: theme.textDim, fontWeight: 700 }}>
        <span>0</span><span>2.5k</span><span>5k</span><span>7.5k</span><span>10k</span>
      </div>
    </div>
  );
}

function StepCountCard() {
  const { t } = useLang();
  const theme = useTheme();
  const [status, setStatus] = useState("loading"); // loading | ok | denied | unavailable
  const [steps, setSteps] = useState(0);

  useEffect(() => {
    let mounted = true;
    let interval;
    (async () => {
      const result = await getTodaySteps();
      if (!mounted) return;
      if (result == null) { setStatus("unavailable"); return; }
      if (result.denied) { setStatus("denied"); return; }
      setSteps(result.steps);
      setStatus("ok");
      interval = setInterval(async () => {
        const r = await getTodaySteps();
        if (mounted && r && r.steps != null) setSteps(r.steps);
      }, 10000);
    })();
    return () => { mounted = false; if (interval) clearInterval(interval); };
  }, []);

  if (status === "unavailable") return null; // no sensor / not on native — nothing useful to show

  return (
    <Card>
      <SectionTitle>
        <Footprints size={13} style={{ verticalAlign: -1, marginRight: 4 }} color={theme.lift} />
        {t("오늘의 걸음수", "Today's Steps")}
      </SectionTitle>
      {status === "loading" ? (
        <div style={{ height: 30, width: "50%", borderRadius: 12, background: theme.surfaceRaised, animation: "hlSkeletonPulse 1.4s ease-in-out infinite" }} />
      ) : status === "denied" ? (
        <EmptyState text={t("걸음수 권한이 필요해요. 안드로이드 앱 설정 → 권한에서 '신체 활동'을 허용해주세요.", "Step tracking needs permission — enable 'Physical activity' in the app's Android settings.")} />
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums", fontFamily: FONT_STACK }}>{steps.toLocaleString()}</span>
            <span style={{ fontSize: 12, color: theme.textDim }}>{t("걸음", "steps")}</span>
          </div>
          <StepAchievementBar steps={steps} />
        </div>
      )}
    </Card>
  );
}

function DayLogCard({ dayLogs, setDayLogs }) {
  const { t } = useLang();
  const theme = useTheme();
  const today = todayStr();
  const todayEntry = dayLogs.find((d) => d.date === today);

  const [editing, setEditing] = useState(!todayEntry);
  const [showHistory, setShowHistory] = useState(false);
  const [mood, setMood] = useState(todayEntry?.mood || 0);
  const [energy, setEnergy] = useState(todayEntry?.energy || 0);
  const [sleep, setSleep] = useState(todayEntry?.sleep || 0);
  const [note, setNote] = useState(todayEntry?.note || "");
  const [draftRestored, setDraftRestored] = useState(false);

  // Auto-save a draft while editing today's entry, so a half-filled Day Log
  // isn't lost if the app gets closed/backgrounded before hitting Save —
  // same pattern as the workout draft in WorkoutsTab.
  useEffect(() => {
    if (todayEntry) return; // only draft a fresh entry, not edits to an already-saved one
    (async () => {
      const draft = await loadKey("dayLogDraft", null);
      if (draft && draft.date === today && draft.form) {
        setMood(draft.form.mood || 0);
        setEnergy(draft.form.energy || 0);
        setSleep(draft.form.sleep || 0);
        setNote(draft.form.note || "");
        setDraftRestored(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (todayEntry || !editing) return;
    saveKey("dayLogDraft", { date: today, form: { mood, energy, sleep, note } });
  }, [mood, energy, sleep, note, editing, todayEntry, today]);

  const save = () => {
    const entry = { id: todayEntry?.id || uid(), date: today, mood, energy, sleep, note };
    setDayLogs([entry, ...dayLogs.filter((d) => d.date !== today)]);
    setEditing(false);
    deleteKey("dayLogDraft");
  };
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const remove = (id) => setConfirmDeleteId(id);
  const confirmRemove = () => {
    setDayLogs(dayLogs.filter((d) => d.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const ScaleRow = ({ label, value, onChange }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 12.5, color: theme.textDim }}>{label}</span>
      <div style={{ display: "flex", gap: 5 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const stepT = 0.2 + ((n - 1) / 4) * 0.8;
          const active = value === n;
          return (
            <button key={n} onClick={() => onChange(n)} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}
              style={{
                width: 28, height: 28, borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: active ? `2px solid ${theme.text}` : "1px solid transparent",
                background: mixHex(theme.surfaceRaised, theme.lift, stepT),
                color: theme.text,
                opacity: active ? 1 : 0.5,
                transform: active ? "scale(1.08)" : "scale(1)",
                transition: "transform 0.15s ease, opacity 0.15s ease",
              }}>
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );

  const sorted = [...dayLogs].sort((a, b) => b.date.localeCompare(a.date));

  const streak = useMemo(() => {
    const dateSet = new Set(dayLogs.map((d) => d.date));
    let count = 0;
    const cursor = nowDate();
    if (!dateSet.has(todayStr())) cursor.setDate(cursor.getDate() - 1);
    while (dateSet.has(localDateStr(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }, [dayLogs]);
  // Only flag the day a milestone is actually reached, not every day after —
  // this should feel like a one-time moment, not a persistent badge.
  const streakMilestone = todayEntry && [7, 30, 100].includes(streak) ? streak : null;

  return (
    <>
    {confirmDeleteId && (
      <ConfirmDialog message={t("이 데일리 로그 기록을 삭제할까요? 되돌릴 수 없어요.", "Delete this Day Log entry? This can't be undone.")} onConfirm={confirmRemove} onCancel={() => setConfirmDeleteId(null)} />
    )}
    <Card>
      {streakMilestone && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, background: tint(theme.lift, 0.18),
          border: `1px solid ${theme.lift}`, borderRadius: 12, padding: "8px 12px", marginBottom: 12,
        }}>
          <Award size={16} color={theme.lift} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: theme.lift, fontFamily: FONT_STACK, fontStyle: "italic" }}>
            {t(`특보: ${streakMilestone}일 연속 기록 달성!`, `Special edition: ${streakMilestone}-day streak!`)}
          </span>
        </div>
      )}
      <SectionTitle right={
        <button onClick={() => setShowHistory((v) => !v)} style={{ background: "none", border: "none", color: theme.textDim, cursor: "pointer", fontSize: 11 }}>
          {showHistory ? t("닫기", "Close") : t("전체 기록", "View All")}
        </button>
      }>
        {t("데일리 로그", "Day Log")}
        {streak > 0 && (
          <span style={{ marginLeft: 8, fontSize: 12, color: theme.run, fontWeight: 700, fontStyle: "normal", fontFamily: BODY_FONT_STACK, display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle" }}>
            <Flame size={12} /> {t(`${streak}일 연속`, `${streak}d streak`)}
          </span>
        )}
      </SectionTitle>

      {!showHistory ? (
        editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {!todayEntry && (
              <div style={{ fontSize: 12, color: theme.textFaint, display: "flex", alignItems: "center", gap: 5 }}>
                <Clock size={11} style={{ flexShrink: 0 }} />
                <span>
                  {draftRestored
                    ? t("임시저장된 기록을 불러왔어요.", "Restored your in-progress draft.")
                    : t("자동으로 임시저장돼요.", "Auto-saving as you go.")}
                </span>
              </div>
            )}
            <ScaleRow label={t("기분", "Mood")} value={mood} onChange={setMood} />
            <ScaleRow label={t("에너지", "Energy")} value={energy} onChange={setEnergy} />
            <ScaleRow label={t("수면", "Sleep")} value={sleep} onChange={setSleep} />
            <textarea value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("오늘 하루는 어땠나요?", "How was your day?")}
              style={{ ...getInputStyle(theme), minHeight: 64, resize: "vertical", fontFamily: "inherit" }} />
            <PrimaryButton onClick={save} disabled={!mood || !energy || !sleep}>{t("저장", "Save")}</PrimaryButton>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: theme.textDim }}>
              {t("기분", "Mood")} {todayEntry.mood}/5 · {t("에너지", "Energy")} {todayEntry.energy}/5 · {t("수면", "Sleep")} {todayEntry.sleep}/5{todayEntry.activityLevel ? ` · ${t("활동량", "Activity")} ${todayEntry.activityLevel}/5` : ""}
            </div>
            {todayEntry.note && (
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <span style={{ fontSize: 30, fontFamily: FONT_STACK, color: theme.lift, lineHeight: 0.5, fontWeight: 700, flexShrink: 0 }}>&#8220;</span>
                <div style={{ fontSize: 12.5, color: theme.text, fontStyle: "italic", lineHeight: 1.5, fontFamily: FONT_STACK, paddingTop: 6 }}>
                  {todayEntry.note}
                  <span style={{ fontSize: 20, color: theme.lift, fontWeight: 700 }}>&#8221;</span>
                </div>
              </div>
            )}
            <button onClick={() => setEditing(true)}
              style={{ background: "none", border: "none", color: theme.lift, cursor: "pointer", fontSize: 12, padding: 0, textAlign: "left", display: "flex", alignItems: "center", gap: 4 }}>
              <Pencil size={12} /> {t("수정", "Edit")}
            </button>
          </div>
        )
      ) : (
        <DayLogStack sorted={sorted} remove={remove} theme={theme} t={t} />
      )}
    </Card>
    </>
  );
}

function DayLogStack({ sorted, remove, theme, t }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const touchStartRef = useRef(null); // { x, y }
  const dragAxisRef = useRef(null); // 'vertical' | 'horizontal' | null (undecided)

  useEffect(() => {
    if (activeIdx > sorted.length - 1) setActiveIdx(Math.max(0, sorted.length - 1));
  }, [sorted.length, activeIdx]);

  const goTo = (delta) => {
    setActiveIdx((i) => Math.max(0, Math.min(sorted.length - 1, i + delta)));
  };

  const onTouchStart = (e) => {
    e.stopPropagation(); // this stack has no horizontal purpose of its own — always claim touches that start here
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    dragAxisRef.current = null;
  };
  const onTouchMove = (e) => {
    e.stopPropagation();
    const start = touchStartRef.current;
    if (!start) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dragAxisRef.current == null) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.3) dragAxisRef.current = "vertical";
    }
    if (dragAxisRef.current === "vertical") e.preventDefault();
  };
  const onTouchEnd = (e) => {
    e.stopPropagation();
    const start = touchStartRef.current;
    const wasVertical = dragAxisRef.current === "vertical";
    touchStartRef.current = null;
    dragAxisRef.current = null;
    if (!start || !wasVertical) return;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dy) < 24) return;
    goTo(dy < 0 ? 1 : -1);
  };
  // Mouse wheel also just moves one card at a time — no reliance on
  // native element scrolling/overflow, which wasn't behaving reliably.
  const onWheel = (e) => {
    e.preventDefault();
    if (Math.abs(e.deltaY) < 8) return;
    goTo(e.deltaY > 0 ? 1 : -1);
  };

  if (sorted.length === 0) return <EmptyState text={t("아직 기록이 없습니다.", "No entries yet.")} />;

  return (
    <div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        style={{ position: "relative", height: 132, marginBottom: 10, touchAction: "pan-x", overscrollBehavior: "contain" }}
      >
        {sorted.map((d, i) => {
          const offset = i - activeIdx;
          if (Math.abs(offset) > 2) return null;
          const active = offset === 0;
          return (
            <div key={d.id}
              style={{
                position: "absolute", top: 0, left: 0, right: 0,
                zIndex: 100 - Math.abs(offset),
                opacity: Math.abs(offset) > 1 ? 0 : 1,
                pointerEvents: active ? "auto" : "none",
                transform: `translateY(${offset * 16}px) scale(${1 - Math.abs(offset) * 0.06})`,
                transition: "transform 0.25s ease, opacity 0.25s ease, box-shadow 0.25s ease",
                background: theme.darkPanel || theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12,
                padding: "12px 14px", boxSizing: "border-box",
                boxShadow: active ? cardShadow(theme, 0.22) : cardShadow(theme, 0.08),
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: theme.text, fontFamily: FONT_STACK }}>{fmtDate(d.date)}</span>
                {active && (
                  <IconBtn danger onClick={() => remove(d.id)}><Trash2 size={12} /></IconBtn>
                )}
              </div>
              <div style={{ fontSize: 12, color: theme.textFaint }}>
                {t("기분", "Mood")} {d.mood}/5 · {t("에너지", "Energy")} {d.energy}/5 · {t("수면", "Sleep")} {d.sleep}/5{d.activityLevel ? ` · ${t("활동량", "Activity")} ${d.activityLevel}/5` : ""}
              </div>
              {d.note && (
                <div style={{ display: "flex", gap: 5, alignItems: "flex-start", marginTop: 6 }}>
                  <span style={{ fontSize: 22, fontFamily: FONT_STACK, color: theme.lift, lineHeight: 0.5, fontWeight: 700, flexShrink: 0, opacity: 0.7 }}>&#8220;</span>
                  <div style={{ fontSize: 12, color: theme.textDim, fontStyle: "italic", lineHeight: 1.4, fontFamily: FONT_STACK, paddingTop: 4 }}>
                    {d.note}
                    <span style={{ fontSize: 16, color: theme.lift, fontWeight: 700, opacity: 0.7 }}>&#8221;</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18 }}>
        <button onClick={() => goTo(-1)} disabled={activeIdx === 0} aria-label={t("이전 기록", "Previous entry")}
          style={{ background: "none", border: "none", cursor: activeIdx === 0 ? "default" : "pointer", color: activeIdx === 0 ? theme.border : theme.text, padding: 4 }}>
          <ChevronUp size={18} />
        </button>
        <span style={{ fontSize: 12, color: theme.textFaint, fontVariantNumeric: "tabular-nums" }}>{activeIdx + 1} / {sorted.length}</span>
        <button onClick={() => goTo(1)} disabled={activeIdx === sorted.length - 1} aria-label={t("다음 기록", "Next entry")}
          style={{ background: "none", border: "none", cursor: activeIdx === sorted.length - 1 ? "default" : "pointer", color: activeIdx === sorted.length - 1 ? theme.border : theme.text, padding: 4 }}>
          <ChevronDown size={18} />
        </button>
      </div>
    </div>
  );
}

function ProgramEditor({ program, onChange, onDelete }) {
  const { t } = useLang();
  const theme = useTheme();
  const updateExercise = (idx, field, value) => {
    const next = program.exercises.map((ex, i) => (
      i === idx ? { ...ex, [field]: value } : ex
    ));
    onChange({ ...program, exercises: next });
  };
  const addExercise = () => onChange({ ...program, exercises: [...program.exercises, { name: "", sets: 2, repRange: "6-12", muscle: null }] });
  const removeExercise = (idx) => onChange({ ...program, exercises: program.exercises.filter((_, i) => i !== idx) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label={t("프로그램 이름", "Program Name")}>
        <TextInput value={program.name} onChange={(e) => onChange({ ...program, name: e.target.value })} />
      </Field>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {program.exercises.map((ex, idx) => (
          <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 6, borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <TextInput style={{ flex: 2.2 }} placeholder={t("운동 이름", "Exercise name")} value={ex.name} onChange={(e) => updateExercise(idx, "name", e.target.value)} />
              <TextInput style={{ flex: 0.9 }} type="number" min="1" placeholder={t("세트", "Sets")} value={ex.sets} onChange={(e) => updateExercise(idx, "sets", e.target.value)} />
              <TextInput style={{ flex: 1 }} placeholder={t("반복수", "Reps")} value={ex.repRange} onChange={(e) => updateExercise(idx, "repRange", e.target.value)} />
              <button onClick={() => removeExercise(idx)} style={{ background: "none", border: "none", color: theme.danger, cursor: "pointer", padding: 4, flexShrink: 0 }}>
                <X size={14} />
              </button>
            </div>
            <Select value={ex.muscle || ""} onChange={(e) => updateExercise(idx, "muscle", e.target.value || null)}
              style={{ padding: "6px 8px", fontSize: 12, minHeight: 36 }}>
              <option value="">{t("부위 선택 (선택)", "Muscle group (optional)")}</option>
              {Object.entries(MUSCLE_GROUPS).map(([id, g]) => (
                <option key={id} value={id}>{g.label(t)}</option>
              ))}
            </Select>
          </div>
        ))}
        {program.exercises.length === 0 && (
          <div style={{ fontSize: 12, color: theme.textFaint, padding: "4px 0" }}>{t("운동이 없습니다. 아래에서 추가하세요.", "No exercises yet. Add one below.")}</div>
        )}
      </div>
      <button onClick={addExercise}
        style={{ background: "none", border: `1px dashed ${theme.border}`, borderRadius: 12, padding: "6px 10px", color: theme.textDim, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <Plus size={12} /> {t("운동 추가", "Add Exercise")}
      </button>
      {onDelete && (
        <button onClick={onDelete} style={{ background: "none", border: "none", color: theme.danger, fontSize: 12, cursor: "pointer", padding: "4px 0", textAlign: "left" }}>
          {t("이 프로그램 삭제", "Delete this program")}
        </button>
      )}
    </div>
  );
}

function DayEditorPanel({ dayIdx, weekPlan, setWeekPlan, programs, setPrograms, onClose }) {
  const { lang, t } = useLang();
  const theme = useTheme();
  const entry = weekPlan[dayIdx];
  const [kind, setKind] = useState(entry.kind);
  const [programId, setProgramId] = useState(entry.programId || programs[0]?.id || null);
  const [runChoice, setRunChoice] = useState(
    entry.runLabel === "L.R" || entry.runLabel === "S.R" ? entry.runLabel : (entry.runLabel ? "기타" : "S.R")
  );
  const [customRunLabel, setCustomRunLabel] = useState(runChoice === "기타" ? entry.runLabel : "");
  const [showNewProgram, setShowNewProgram] = useState(false);
  const [newProgramName, setNewProgramName] = useState("");
  const [editingProgramId, setEditingProgramId] = useState(null);

  const save = () => {
    const next = weekPlan.map((d, i) => {
      if (i !== dayIdx) return d;
      if (kind === "lift") return { day: d.day, kind, programId };
      if (kind === "run") return { day: d.day, kind, runLabel: runChoice === "기타" ? (customRunLabel || t("런", "Run")) : runChoice };
      return { day: d.day, kind: "rest" };
    });
    setWeekPlan(next);
    onClose();
  };

  const createProgram = () => {
    if (!newProgramName.trim()) return;
    const np = { id: uid(), name: newProgramName.trim(), exercises: [] };
    setPrograms([...programs, np]);
    setProgramId(np.id);
    setNewProgramName("");
    setShowNewProgram(false);
    setEditingProgramId(np.id);
  };
  const updateProgram = (updated) => setPrograms(programs.map((p) => (p.id === updated.id ? updated : p)));
  const deleteProgram = (id) => {
    setPrograms(programs.filter((p) => p.id !== id));
    if (programId === id) setProgramId(programs.find((p) => p.id !== id)?.id || null);
    setEditingProgramId(null);
  };

  const editingProgram = programs.find((p) => p.id === editingProgramId);
  const chipStyle = (active) => ({
    padding: "8px 4px", borderRadius: 12, fontSize: 12.5, flex: 1,
    border: `1px solid ${active ? theme.lift : theme.border}`,
    background: active ? tint(theme.lift, 0.16) : "transparent",
    color: theme.text, cursor: "pointer",
  });

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <SectionTitle>{WEEKDAY_LABELS[lang][dayIdx]} {t("설정", "Settings")}</SectionTitle>
        <IconBtn onClick={onClose}><X size={16} /></IconBtn>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button onClick={() => setKind("lift")} style={chipStyle(kind === "lift")}>{t("리프팅", "Lifting")}</button>
        <button onClick={() => setKind("run")} style={chipStyle(kind === "run")}>{t("러닝", "Running")}</button>
        <button onClick={() => setKind("rest")} style={chipStyle(kind === "rest")}>Rest</button>
      </div>

      {kind === "lift" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {programs.map((p) => (
              <button key={p.id} onClick={() => setProgramId(p.id)}
                style={{
                  padding: "7px 12px", borderRadius: 12, fontSize: 12.5,
                  border: `1px solid ${programId === p.id ? theme.lift : theme.border}`,
                  background: programId === p.id ? tint(theme.lift, 0.16) : "transparent",
                  color: theme.text, cursor: "pointer",
                }}>
                {p.name}
              </button>
            ))}
            <button onClick={() => setShowNewProgram((v) => !v)}
              style={{ padding: "7px 12px", borderRadius: 12, fontSize: 12.5, border: `1px dashed ${theme.border}`, background: "transparent", color: theme.textDim, cursor: "pointer" }}>
              + {t("새 프로그램", "New Program")}
            </button>
          </div>

          {showNewProgram && (
            <div style={{ display: "flex", gap: 6 }}>
              <TextInput value={newProgramName} onChange={(e) => setNewProgramName(e.target.value)} placeholder={t("예: Upper", "e.g. Upper")} />
              <PrimaryButton onClick={createProgram} style={{ width: "auto", padding: "9px 14px" }}>{t("추가", "Add")}</PrimaryButton>
            </div>
          )}

          {programId && (
            <button onClick={() => setEditingProgramId(editingProgramId === programId ? null : programId)}
              style={{ background: "none", border: "none", color: theme.textDim, fontSize: 12, cursor: "pointer", padding: "2px 0", textAlign: "left", display: "flex", alignItems: "center", gap: 4 }}>
              <Settings2 size={12} /> {programs.find((p) => p.id === programId)?.name} {t("운동 편집", "Edit Exercises")}
            </button>
          )}

          {editingProgram && (
            <Card style={{ background: theme.surfaceRaised, padding: 10 }}>
              <ProgramEditor
                program={editingProgram}
                onChange={updateProgram}
                onDelete={programs.length > 1 ? () => deleteProgram(editingProgram.id) : undefined}
              />
            </Card>
          )}
        </div>
      )}

      {kind === "run" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setRunChoice("S.R")} style={chipStyle(runChoice === "S.R")}>Short</button>
            <button onClick={() => setRunChoice("L.R")} style={chipStyle(runChoice === "L.R")}>Long</button>
            <button onClick={() => setRunChoice("기타")} style={chipStyle(runChoice === "기타")}>{t("기타", "Other")}</button>
          </div>
          {runChoice === "기타" && (
            <TextInput value={customRunLabel} onChange={(e) => setCustomRunLabel(e.target.value)} placeholder={t("라벨 (예: 템포런)", "Label (e.g. Tempo Run)")} />
          )}
        </div>
      )}

      <PrimaryButton onClick={save}>{t("저장", "Save")}</PrimaryButton>
    </Card>
  );
}

function GoalTargetsPanel({ settings, onSaveSettings, effectiveTdee, currentWeight, currentBF, weekPlan }) {
  const { t } = useLang();
  const theme = useTheme();
  const mode = settings.goalMode || "cut";
  const setMode = (m, e) => { if (e) e.stopPropagation(); onSaveSettings({ ...settings, goalMode: m }); };
  const setTier = (key, e) => {
    if (e) e.stopPropagation();
    onSaveSettings({ ...settings, [mode === "gain" ? "gainTier" : "cutTier"]: key });
  };
  const setCarbPct = (pct, e) => { if (e) e.stopPropagation(); onSaveSettings({ ...settings, carbPercent: pct }); };

  if (!effectiveTdee || !currentWeight) {
    return <EmptyState text={t("목표별 칼로리를 계산할 데이터가 더 필요해요.", "Need a bit more data to calculate targets.")} />;
  }

  const trainingDays = weekPlan ? weekPlan.filter((d) => d.kind !== "rest").length : 0;
  const carbPercent = settings.carbPercent ?? null;
  const medicalBlock = settings.pregnantOrBreastfeeding || settings.edRecoveryOrClinical;

  const modeButtons = (
    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
      {[
        { id: "cut", label: t("다이어트", "Cut") },
        { id: "maintain", label: t("유지어트", "Maintain") },
        { id: "gain", label: t("증량", "Gain") },
      ].map((m) => (
        <button key={m.id} onClick={(e) => setMode(m.id, e)} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}
          style={{
            flex: 1, padding: 9, borderRadius: 12, fontSize: 12.5, cursor: "pointer",
            border: `1px solid ${mode === m.id ? theme.lift : theme.border}`,
            background: mode === m.id ? tint(theme.lift, 0.16) : "transparent",
            color: theme.text, fontWeight: mode === m.id ? 700 : 500,
          }}>
          {m.label}
        </button>
      ))}
    </div>
  );

  const carbControl = (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${theme.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.04em" }}>{t("탄수화물 비율", "Carb Ratio")}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>
          {carbPercent == null ? t("자동", "Auto") : `${carbPercent}%`}
        </span>
      </div>
      <input
        type="range" min={0} max={60} step={5}
        value={carbPercent ?? 40}
        onChange={(e) => setCarbPct(Number(e.target.value))}
        onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}
        style={{ width: "100%", accentColor: theme.lift }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
        <span style={{ fontSize: 12, color: theme.textFaint }}>0%</span>
        <button onClick={(e) => setCarbPct(null, e)} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: 12, color: carbPercent == null ? theme.lift : theme.textFaint,
            fontWeight: carbPercent == null ? 700 : 500,
          }}>
          {t("자동으로", "Reset to Auto")}
        </button>
        <span style={{ fontSize: 12, color: theme.textFaint }}>60%</span>
      </div>
    </div>
  );

  const TierRow = ({ tierKey, label, target, macros, selected, onSelect }) => (
    <button onClick={onSelect} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} style={{
      display: "flex", alignItems: "flex-start", gap: 8, width: "100%", textAlign: "left",
      background: selected ? tint(theme.lift, 0.1) : "transparent",
      border: `1px solid ${selected ? theme.lift : theme.border}`,
      borderRadius: 12, padding: 9, cursor: "pointer",
    }}>
      <div style={{
        width: 15, height: 15, borderRadius: "50%", flexShrink: 0, marginTop: 2,
        border: `2px solid ${selected ? theme.lift : theme.border}`,
        background: selected ? theme.lift : "transparent",
      }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12.5, color: theme.text, fontWeight: selected ? 700 : 500 }}>{label}</span>
          <span style={{ fontSize: 12.5, color: theme.text, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{Math.round(target)} kcal</span>
        </div>
        <div style={{ fontSize: 12, color: theme.textFaint }}>
          {t("단백", "P")} {macros.proteinG}g · {t("탄수", "C")} {macros.carbG}g · {t("지방", "F")} {macros.fatG}g
        </div>
      </div>
    </button>
  );

  if (mode === "gain") {
    const activeTier = settings.gainTier || "lean";
    return (
      <div>
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(GAIN_TIERS).map(([key, def]) => {
              const target = dailyTargetForGain(effectiveTdee, currentWeight, def.frac);
              const macros = macrosFor(target, currentWeight, settings.sex, currentBF, carbPercent);
              return (
                <TierRow key={key} tierKey={key} label={def.label(t)} target={target} macros={macros}
                  selected={activeTier === key} onSelect={(e) => setTier(key, e)} />
              );
            })}
          </div>
          {carbControl}
        </div>
      </div>
    );
  }

  if (mode === "maintain") {
    const macros = macrosFor(effectiveTdee, currentWeight, settings.sex, currentBF, carbPercent);
    return (
      <div>
        <div>
          <Stat label={t("유지 칼로리", "Maintenance")} value={`${Math.round(effectiveTdee)} kcal`} />
          <div style={{ fontSize: 12, color: theme.textFaint, paddingLeft: 2, marginTop: 4 }}>
            {t("단백", "P")} {macros.proteinG}g · {t("탄수", "C")} {macros.carbG}g · {t("지방", "F")} {macros.fatG}g
          </div>
          <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 10, lineHeight: 1.5 }}>
            {t("다이어트 직후라면 주당 +100kcal씩 천천히 늘려가세요.", "Coming off a cut? Ramp up +100 kcal/week rather than jumping straight here.")}
          </div>
          {carbControl}
        </div>
      </div>
    );
  }

  // cut
  const activeTier = settings.cutTier || "standard";
  const bmrForFloor = (settings.ageYears && settings.heightCm && currentWeight)
    ? bmrMifflin(settings.sex || "male", settings.ageYears, settings.heightCm, currentWeight)
    : null;
  const standardTarget = dailyTargetForRate(effectiveTdee, currentWeight, CUT_TIERS.standard.frac, bmrForFloor, settings.sex);
  const cycle = trainingDays > 0 ? cycleTargets(Math.round(standardTarget), trainingDays) : null;
  const cheatBudget = specialDayBudget(Math.round(effectiveTdee), Math.round(standardTarget), 1);

  return (
    <div>
      <div>
        {medicalBlock ? (
          <div style={{ fontSize: 12, color: theme.danger, lineHeight: 1.6, fontWeight: 600, padding: "4px 2px" }}>
            {t(
              "⚠ 설정에 표시된 건강 상태 때문에 다이어트 목표를 자동으로 제공하지 않아요. 유지 칼로리는 계속 확인할 수 있고, 감량 계획이 필요하면 전문가와 상담해주세요.",
              "⚠ An automated cut target isn't offered because of the health context noted in Settings. You can still see maintenance calories — for a weight-loss plan, please check with a professional."
            )}
          </div>
        ) : (
          <>
            {(() => {
              const range = recommendedLossRateRange(settings.sex, currentBF);
              return range ? (
                <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 8, lineHeight: 1.5 }}>
                  {t(
                    `권장 범위(현재 체지방 기준): 주당 ${(range[0]*100).toFixed(2)}~${(range[1]*100).toFixed(2)}%`,
                    `Recommended range (based on current body fat): ${(range[0]*100).toFixed(2)}–${(range[1]*100).toFixed(2)}%/week`
                  )}
                </div>
              ) : null;
            })()}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.entries(CUT_TIERS).map(([key, def]) => {
                const target = dailyTargetForRate(effectiveTdee, currentWeight, def.frac, bmrForFloor, settings.sex);
                const macros = macrosFor(target, currentWeight, settings.sex, currentBF, carbPercent);
                const range = recommendedLossRateRange(settings.sex, currentBF);
                const outOfRange = range && (def.frac < range[0] || def.frac > range[1]);
                return (
                  <div key={key}>
                    <TierRow tierKey={key} label={def.label(t)} target={target} macros={macros}
                      selected={activeTier === key} onSelect={(e) => setTier(key, e)} />
                    {outOfRange && activeTier === key && (
                      <div style={{ fontSize: 12, color: theme.danger, marginTop: 4, paddingLeft: 4, lineHeight: 1.4 }}>
                        {def.frac > range[1]
                          ? t("현재 체지방 기준 권장 범위보다 빨라요.", "Faster than the recommended range for your current body fat.")
                          : t("권장 범위보다 느려요 — 안전하지만 목표까지 더 오래 걸려요.", "Slower than the recommended range — safe, but will take longer to reach your goal.")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {cycle && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.04em" }}>
                  {t(`표준 기준 · 운동일 ${trainingDays}일/주`, `Standard tier · ${trainingDays} training days/wk`)}
                </div>
                <Stat label={t("운동일 목표", "Training day")} value={`${cycle.training} kcal`} />
                <Stat label={t("휴식일 목표", "Rest day")} value={`${cycle.rest} kcal`} />
                <Stat label={t("치팅데이 예산 (주 1회)", "Cheat day budget (1x/wk)")} value={`${Math.round(cheatBudget)} kcal`} />
              </div>
            )}
          </>
        )}
        {carbControl}
      </div>
    </div>
  );
}


function Dashboard({ settings, bodycomp, workouts, nutrition, programs, setPrograms, weekPlan, setWeekPlan, dayLogs, setDayLogs, onSaveSettings, recentAvgSteps }) {
  const { lang, t } = useLang();
  const theme = useTheme();
  const hasGoals = settings.startWeight > 0;
  const [flipped, setFlipped] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const longPressTimerRef = useRef(null);
  const longPressStartRef = useRef(null); // { x, y } for touch-move cancellation
  const longPressMovedRef = useRef(false);
  const beginLongPress = () => {
    if (reorderMode) return;
    longPressMovedRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      if (!longPressMovedRef.current) {
        haptic();
        setReorderMode(true);
        if (!settings.reorderHintDismissed) onSaveSettings({ ...settings, reorderHintDismissed: true });
      }
    }, 650);
  };
  const cancelLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    longPressStartRef.current = null;
  };
  const longPressTouchStart = (e) => {
    const t0 = e.touches[0];
    longPressStartRef.current = { x: t0.clientX, y: t0.clientY };
    beginLongPress();
  };
  const longPressTouchMove = (e) => {
    const start = longPressStartRef.current;
    if (!start) return;
    const t0 = e.touches[0];
    if (Math.abs(t0.clientX - start.x) > 8 || Math.abs(t0.clientY - start.y) > 8) {
      longPressMovedRef.current = true;
      cancelLongPress();
    }
  };
  const [flipAnim, setFlipAnim] = useState(false);
  const [editing, setEditing] = useState(!hasGoals);
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);

  const sorted = [...bodycomp].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const currentWeight = latest ? latest.weight : (settings.startWeight || null);
  const currentBF = latest?.bodyfat ?? null;
  const hasWeight = currentWeight != null && currentWeight > 0;

  const weightTrend = (() => {
    const cutoff = nowDate();
    cutoff.setDate(cutoff.getDate() - 30);
    const byDate = {};
    sorted.forEach((b) => { byDate[b.date] = b.weight; }); // later same-date entries win
    return Object.entries(byDate)
      .filter(([date]) => new Date(date) >= cutoff)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, weight]) => ({ date, weight }));
  })();

  const goalMid = (settings.goalWeightLow + settings.goalWeightHigh) / 2;
  const totalToLose = settings.startWeight - goalMid;
  const lostSoFar = settings.startWeight - (currentWeight || 0);
  const weightPct = totalToLose > 0 ? (lostSoFar / totalToLose) * 100 : 0;
  const goalReached = hasGoals && hasWeight && currentWeight >= settings.goalWeightLow && currentWeight <= settings.goalWeightHigh;

  // weekly pace from last 14 days of bodycomp entries
  const recentCut = sorted.filter((e) => {
    const days = (nowDate() - new Date(e.date)) / 86400000;
    return days <= 21;
  });
  let weeklyRate = null;
  if (recentCut.length >= 2) {
    const first = recentCut[0];
    const last = recentCut[recentCut.length - 1];
    const days = (new Date(last.date) - new Date(first.date)) / 86400000;
    if (days > 0) weeklyRate = ((first.weight - last.weight) / days) * 7;
  }
  const remainingKg = (currentWeight || 0) - goalMid;
  const etaWeeks = weeklyRate && weeklyRate > 0.05 ? Math.max(0, remainingKg / weeklyRate) : null;
  const etaDateStr = etaWeeks != null ? (() => {
    const d = nowDate();
    d.setDate(d.getDate() + Math.round(etaWeeks * 7));
    return fmtDate(localDateStr(d));
  })() : null;
  // Two-tier pace guardrail (ported from DietEngineV3): caution above 1%
  // bodyweight/week, a stronger "pause and review" flag above 1.25%.
  const pacePctOfBodyweight = currentWeight && weeklyRate ? weeklyRate / currentWeight : 0;
  const paceSeverity = pacePctOfBodyweight > 0.0125 ? "review" : pacePctOfBodyweight > 0.01 ? "caution" : null;

  // Muscle-loss risk (cut mode): compare total weight lost against fat
  // mass lost over the same window. If a large share of what's coming off
  // isn't fat, that's a sign of excessive muscle loss even if the scale
  // trend "looks good."
  const muscleLossWarning = (() => {
    if (settings.goalMode !== "cut") return null;
    const withBF = recentCut.filter((e) => e.bodyfat != null);
    if (withBF.length < 2) return null;
    const first = withBF[0], last = withBF[withBF.length - 1];
    const weightChange = first.weight - last.weight; // positive = lost weight
    if (weightChange <= 0.3) return null; // too little change to read anything into
    const fatMassFirst = first.weight * (first.bodyfat / 100);
    const fatMassLast = last.weight * (last.bodyfat / 100);
    const leanFraction = (weightChange - (fatMassFirst - fatMassLast)) / weightChange;
    if (leanFraction > 0.4) return { severity: "review", pct: Math.round(leanFraction * 100) };
    if (leanFraction > 0.25) return { severity: "caution", pct: Math.round(leanFraction * 100) };
    return null;
  })();

  // Dirty-bulk risk (gain mode): compare total weight gained against
  // muscle mass gained, when muscle mass is being logged. If most of the
  // gain isn't muscle, the surplus is likely too large.
  const dirtyBulkWarning = (() => {
    if (settings.goalMode !== "gain") return null;
    const withMuscle = recentCut.filter((e) => e.muscleMass != null);
    if (withMuscle.length < 2) return null;
    const first = withMuscle[0], last = withMuscle[withMuscle.length - 1];
    const weightChange = last.weight - first.weight; // positive = gained weight
    if (weightChange <= 0.3) return null;
    const muscleChange = last.muscleMass - first.muscleMass;
    const nonMuscleFraction = (weightChange - muscleChange) / weightChange;
    if (nonMuscleFraction > 0.7) return { severity: "review", pct: Math.round(nonMuscleFraction * 100) };
    if (nonMuscleFraction > 0.5) return { severity: "caution", pct: Math.round(nonMuscleFraction * 100) };
    return null;
  })();

  const daysSinceStart = settings.startDate ? Math.max(0, Math.round((nowDate() - new Date(settings.startDate + "T00:00:00")) / 86400000)) : null;
  const daysSinceLastWeighIn = sorted.length ? Math.round((nowDate() - new Date(sorted[sorted.length - 1].date)) / 86400000) : null;

  // A simple, priority-ordered "what should I actually do next" suggestion —
  // picks the single most useful thing to act on right now rather than
  // listing every possible tip.
  const nextStep = (() => {
    if (!hasGoals) return { text: t("목표 체중과 기간을 설정해보세요.", "Set a goal weight and timeframe to get started."), tone: "info" };
    if (goalReached) return { text: t("목표에 도달했어요 — 유지어트로 전환을 고려해보세요.", "You've reached your goal — consider switching to Maintain mode."), tone: "good" };
    if (daysSinceLastWeighIn != null && daysSinceLastWeighIn >= 7) return { text: t("최근 7일간 체중 기록이 없어요 — 오늘 한 번 재보는 게 좋겠어요.", "No weigh-in in 7+ days — worth logging one today.") , tone: "warn" };
    if (paceSeverity === "review") return { text: t("감량 속도가 너무 빨라요 — 완만 티어로 낮추는 걸 추천해요.", "Pace is too fast — switching to the Gentle tier is recommended."), tone: "warn" };
    if (paceSeverity === "caution") return { text: t("속도가 약간 빨라요 — 이번 주는 완만 티어를 고려해보세요.", "Pace is a bit fast — consider the Gentle tier this week."), tone: "warn" };
    if (weeklyRate == null) return { text: t("체중을 며칠 더 기록하면 추세를 계산해드려요.", "Log your weight for a few more days so a trend can be calculated."), tone: "info" };
    if (weeklyRate <= 0.02) return { text: t("최근 체중 변화가 거의 없어요 — 섭취량이나 활동량을 다시 점검해보세요.", "Weight has barely moved recently — worth double-checking intake or activity."), tone: "warn" };
    return { text: t("좋은 속도로 가고 있어요 — 지금 페이스를 유지하세요.", "You're on a good pace — keep this rhythm going."), tone: "good" };
  })();

  const [editingDayIdx, setEditingDayIdx] = useState(null);

  // Re-render at least once a minute so "today" (and the highlight) rolls
  // over to the next day automatically even if the app is just left open —
  // plus an immediate recheck the moment the app comes back to the
  // foreground, since backgrounded timers can be paused/throttled by the OS
  // and shouldn't be the only thing the day-rollover depends on.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const bump = () => setClockTick((v) => v + 1);
    const id = setInterval(bump, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", bump);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", bump);
    };
  }, []);

  // this week's plan completion
  const now = nowDate();
  const dow = now.getDay(); // 0=Sun
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((dow + 6) % 7)); // Monday
  startOfWeek.setHours(0, 0, 0, 0);
  const weekDates = weekPlan.map((_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return localDateStr(d);
  });
  const doneMap = {};
  workouts.forEach((w) => {
    const idx = weekDates.indexOf(w.date);
    if (idx >= 0) doneMap[idx] = true;
  });
  const todayIdx = (dow + 6) % 7;

  const engine = useMemo(
    () => estimateTdeeEngine(settings, bodycomp, nutrition, workouts, currentWeight, recentAvgSteps),
    [settings, bodycomp, nutrition, workouts, currentWeight, recentAvgSteps]
  );
  const observed = useMemo(() => computeObservedTdee(bodycomp, nutrition, 14), [bodycomp, nutrition]);
  // Only an explicitly-accepted calibration (see TdeeTab) changes the
  // baseline; otherwise use the fresh model estimate. This is deliberately
  // NOT the old auto-blended value — targets shouldn't silently drift day
  // to day from observed data alone.
  const effectiveTdee = settings.acceptedTdee ?? (engine ? Math.round(engine.initialTdee / 10) * 10 : (observed ? observed.tdee : null));
  const activeTarget = useMemo(
    () => (effectiveTdee ? computeActiveTarget(settings, effectiveTdee, currentWeight, currentBF) : null),
    [settings, effectiveTdee, currentWeight, currentBF]
  );

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.userName || "USERNAME");
  useEffect(() => setNameDraft(settings.userName || "USERNAME"), [settings.userName]);
  const [greetingIdx] = useState(() => Math.floor(Math.random() * GREETINGS.length));
  const greeting = GREETINGS[greetingIdx](settings.userName || "USERNAME");
  const saveName = () => {
    const trimmed = nameDraft.trim() || "USERNAME";
    onSaveSettings({ ...settings, userName: trimmed });
    setEditingName(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 2px 10px", borderBottom: `2px solid ${theme.text}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: theme.textDim, fontSize: 12, fontWeight: 650 }}>
          <span>{fmtDate(todayStr())}</span><span>{t("이번 주", "WEEK")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          {!editingName ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 760, letterSpacing: "-0.02em", color: theme.text, fontFamily: FONT_STACK }}>{greeting}</div>
              <button onClick={() => setEditingName(true)}
                style={{ background: "none", border: "none", color: theme.textFaint, cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }}>
                <Pencil size={13} />
              </button>
            </>
          ) : (
            <div style={{ display: "flex", gap: 6, width: "100%" }}>
              <TextInput autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()} placeholder={t("이름 입력", "Enter name")} style={{ flex: 1 }} />
              <button onClick={saveName}
                style={{ background: theme.lift, border: "none", borderRadius: 12, padding: "0 14px", color: "#FBFAF2", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                {t("저장", "Save")}
              </button>
            </div>
          )}
        </div>
      </div>

      <Card
        onClick={() => {
          if (flipAnim) return; // ignore rapid re-taps while a flip is already in progress
          setFlipAnim(true);
          setTimeout(() => { setFlipped((f) => !f); setFlipAnim(false); }, 150);
        }}
        style={{
          background: flipped ? theme.surface : tint(theme.lift, 0.075),
          border: `1px solid ${theme.border}`,
          borderTop: `3px solid ${theme.lift}`,
          cursor: "pointer",
          position: "relative",
          padding: 22,
          transition: "height 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), transform 0.15s ease-in-out",
          transform: flipAnim ? "rotateY(90deg)" : "rotateY(0deg)",
        }}
      >
        <div>
          {!flipped ? (
            hasWeight ? (
              <div>
              {goalReached && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, borderLeft: `3px solid ${theme.heroText}`, padding: "7px 10px", background: "rgba(0,0,0,0.12)" }}>
                  <Award size={15} color={theme.heroText} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: theme.text, fontFamily: BODY_FONT_STACK }}>
                    {t("목표 체중 범위에 도달했어요", "Goal weight range reached")}
                  </span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 12, color: theme.textDim, letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" }}>
                    {t("현재 체중", "Current Weight")}
                  </div>
                  <div style={{ fontSize: 34, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums", marginTop: 2, fontFamily: FONT_STACK }}>
                    {currentWeight?.toFixed(1)}<span style={{ fontSize: 16, fontWeight: 500 }}> kg</span>
                  </div>
                  {currentBF != null && (
                    <div style={{ fontSize: 13, color: theme.textDim, marginTop: 4 }}>{t("체지방", "Body Fat")} {currentBF}%</div>
                  )}
                </div>
                {hasGoals && (
                  <div style={{ textAlign: "right", color: theme.textDim, fontSize: 12 }}>
                    <div>{t("시작", "Start")} {settings.startWeight}kg</div>
                    <div style={{ fontWeight: 700, color: theme.text }}>-{lostSoFar.toFixed(1)}kg</div>
                  </div>
                )}
              </div>
              <WeightSparkline entries={weightTrend} goalLow={hasGoals ? settings.goalWeightLow : null} goalHigh={hasGoals ? settings.goalWeightHigh : null} heroText={theme.heroText} />
              </div>
            ) : (
              <div style={{ color: theme.text }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{t("첫 체성분을 기록해보세요", "Log your first measurement")}</div>
              </div>
            )
          ) : (
            <div onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
              <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.06em", marginBottom: 10 }}>
                {t("목표 모드 — 탭해서 뒤집기", "Goal mode — tap to flip back")}
              </div>
              <GoalTargetsPanel
                settings={settings}
                onSaveSettings={onSaveSettings}
                effectiveTdee={effectiveTdee}
                currentWeight={currentWeight}
                currentBF={currentBF}
                weekPlan={weekPlan}
              />
            </div>
          )}
        </div>
      </Card>

      {(() => {
        const cardBlocks = {
          goalProgress: (
            <Card>
              <SectionTitle right={<button onClick={() => setEditing((v) => !v)} style={{ background: "none", border: "none", color: theme.textDim, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}><Settings2 size={13}/> {t("목표 설정", "Goal Settings")}</button>}>
                {t("목표까지 진행률", "Progress to Goal")}
              </SectionTitle>
              {!editing && hasGoals ? (
                <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                  <ProgressRing pct={weightPct} color={theme.ring} trackColor={theme.rest} label={t("체중 감량", "Weight Loss")} sub={`${t("목표", "Goal")} ${goalMid.toFixed(1)}kg`} />
                  <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 8 }}>
                    <Stat label={t("시작한 지", "Time Elapsed")} value={daysSinceStart != null ? t(`${daysSinceStart}일째`, `Day ${daysSinceStart}`) : "-"} />
                    <Stat label={t("목표 체중", "Goal Weight")} value={`${settings.goalWeightLow}–${settings.goalWeightHigh} kg`} />
                    <Stat label={t("목표 체지방", "Goal Body Fat")} value={`${settings.goalBFLow}–${settings.goalBFHigh} %`} />
                    <Stat label={t("최근 감량 속도", "Recent Pace")} value={weeklyRate ? t(`주당 ${weeklyRate.toFixed(2)} kg`, `${weeklyRate.toFixed(2)} kg/week`) : t("데이터 부족", "Not enough data")} />
                    <Stat label={t("목표 도달 예상일", "Est. Goal Date")} value={etaDateStr ? t(`${etaDateStr} 경`, `~${etaDateStr}`) : t("속도 계산 중", "Calculating pace")} />
                  </div>
                  {paceSeverity && (
                    <div style={{ width: "100%", fontSize: 12, color: theme.danger, lineHeight: 1.5, marginTop: 2, fontWeight: paceSeverity === "review" ? 700 : 400 }}>
                      {paceSeverity === "review"
                        ? t("⚠ 최근 속도가 체중의 주당 1.25%를 넘어요 — 더 빨라지기 전에 점검이 필요해요. 유지칼로리 탭에서 완만한 속도로 조정해보세요.", "⚠ Recent pace is over 1.25% of bodyweight/week — this needs a review before going any faster. Consider a gentler tier on the Maintenance tab.")
                        : t("최근 속도가 체중의 주당 1%를 넘어요 — 너무 급한 감량은 근손실·요요 위험이 커요.", "Recent pace is over 1% of bodyweight/week — that's fast enough to risk muscle loss and rebound.")}
                    </div>
                  )}
                  {muscleLossWarning && (
                    <div style={{ width: "100%", fontSize: 12, color: theme.danger, lineHeight: 1.5, marginTop: 2, fontWeight: muscleLossWarning.severity === "review" ? 700 : 400 }}>
                      {muscleLossWarning.severity === "review"
                        ? t(`⚠ 최근 감량분의 약 ${muscleLossWarning.pct}%가 체지방이 아닌 것으로 추정돼요 — 근손실이 심할 수 있어요. 단백질 섭취량과 저항운동을 점검해보세요.`, `⚠ About ${muscleLossWarning.pct}% of recent weight lost appears to be non-fat — possible significant muscle loss. Check protein intake and resistance training.`)
                        : t(`체지방보다 체중이 더 빠르게 줄고 있어요 (비지방 감량 약 ${muscleLossWarning.pct}%) — 단백질 섭취를 늘려보는 게 좋겠어요.`, `Weight is dropping faster than fat mass (~${muscleLossWarning.pct}% non-fat loss) — consider increasing protein intake.`)}
                    </div>
                  )}
                  {dirtyBulkWarning && (
                    <div style={{ width: "100%", fontSize: 12, color: theme.danger, lineHeight: 1.5, marginTop: 2, fontWeight: dirtyBulkWarning.severity === "review" ? 700 : 400 }}>
                      {dirtyBulkWarning.severity === "review"
                        ? t(`⚠ 최근 증량분의 약 ${dirtyBulkWarning.pct}%가 근육이 아닌 것으로 추정돼요 — 더티벌킹 위험이 커요. 서프러스를 줄여보세요.`, `⚠ About ${dirtyBulkWarning.pct}% of recent weight gained appears to be non-muscle — high dirty-bulk risk. Consider reducing your surplus.`)
                        : t(`증량분 중 근육 비중이 낮은 편이에요 (비근육 증가 약 ${dirtyBulkWarning.pct}%) — 서프러스를 살짝 줄여보는 것도 방법이에요.`, `A smaller share of recent gain is muscle (~${dirtyBulkWarning.pct}% non-muscle) — trimming your surplus slightly could help.`)}
                    </div>
                  )}
                  <StatusCallout tone={nextStep.tone === "warn" ? "danger" : "lift"} style={{ width: "100%", marginTop: 4 }}>
                    <span style={{ display: "block", fontSize: 12, fontWeight: 800, color: nextStep.tone === "warn" ? theme.danger : theme.lift, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>
                      {t("다음 스텝", "Next Step")}
                    </span>
                    <span style={{ fontSize: 12.5, color: theme.text }}>{nextStep.text}</span>
                  </StatusCallout>
                </div>
              ) : !editing && !hasGoals ? (
                <EmptyState text={t("목표 설정에서 프로필을 채워보세요", "Set up your profile in Goal Settings")} />
              ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label={t("시작일", "Start Date")}><TextInput type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></Field>
                  <Field label={t("시작 체중(kg)", "Start Weight (kg)")}><TextInput type="number" step="0.1" value={draft.startWeight} onChange={(e) => setDraft({ ...draft, startWeight: e.target.value })} /></Field>
                  <Field label={t("시작 체지방(%)", "Start Body Fat (%)")}><TextInput type="number" step="0.1" value={draft.startBF} onChange={(e) => setDraft({ ...draft, startBF: e.target.value })} /></Field>
                  <Field label={t("키(cm)", "Height (cm)")}><TextInput type="number" value={draft.heightCm} onChange={(e) => setDraft({ ...draft, heightCm: e.target.value })} /></Field>
                  <Field label={t("나이", "Age")}><TextInput type="number" value={draft.ageYears} onChange={(e) => setDraft({ ...draft, ageYears: e.target.value })} /></Field>
                  <Field label={t("성별", "Sex")}>
                    <Select value={draft.sex} onChange={(e) => setDraft({ ...draft, sex: e.target.value })}>
                      <option value="male">{t("남성", "Male")}</option>
                      <option value="female">{t("여성", "Female")}</option>
                    </Select>
                  </Field>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Field label={t("기본 활동 수준 (만보기 기록 없을 때 기준값)", "Baseline Activity Level (used when there's no recent step history)")}>
                      <Select value={draft.activityLevel} onChange={(e) => setDraft({ ...draft, activityLevel: e.target.value })}>
                        {ACTIVITY_LEVELS.map((a) => <option key={a.id} value={a.id}>{a.label(t)}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Field label={t("목표 체중 최소", "Min Goal Weight")}><TextInput type="number" step="0.1" value={draft.goalWeightLow} onChange={(e) => setDraft({ ...draft, goalWeightLow: e.target.value })} /></Field>
                  <Field label={t("목표 체중 최대", "Max Goal Weight")}><TextInput type="number" step="0.1" value={draft.goalWeightHigh} onChange={(e) => setDraft({ ...draft, goalWeightHigh: e.target.value })} /></Field>
                  <Field label={t("목표 체지방 최소", "Min Goal Body Fat")}><TextInput type="number" step="0.1" value={draft.goalBFLow} onChange={(e) => setDraft({ ...draft, goalBFLow: e.target.value })} /></Field>
                  <Field label={t("목표 체지방 최대", "Max Goal Body Fat")}><TextInput type="number" step="0.1" value={draft.goalBFHigh} onChange={(e) => setDraft({ ...draft, goalBFHigh: e.target.value })} /></Field>
                  <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8, marginTop: 4, paddingTop: 10, borderTop: `1px solid ${theme.border}` }}>
                    <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.04em" }}>
                      {t("해당되는 항목이 있으면 표시해주세요 — 다이어트 자동 목표 계산이 꺼지고 유지 칼로리만 보여드려요.", "Check any that apply — this turns off automated cut targets and shows maintenance calories only.")}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: theme.text, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!draft.pregnantOrBreastfeeding} onChange={(e) => setDraft({ ...draft, pregnantOrBreastfeeding: e.target.checked })} />
                      {t("임신 또는 수유 중이에요", "I'm pregnant or breastfeeding")}
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: theme.text, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!draft.edRecoveryOrClinical} onChange={(e) => setDraft({ ...draft, edRecoveryOrClinical: e.target.checked })} />
                      {t("식이장애 회복 중이거나 관련 임상 제한이 있어요", "I'm in eating-disorder recovery or have a related clinical restriction")}
                    </label>
                  </div>
                  <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
                    <PrimaryButton onClick={() => {
                      const cleaned = {
                        ...draft,
                        startWeight: Number(draft.startWeight) || 0,
                        startBF: Number(draft.startBF) || 0,
                        heightCm: Number(draft.heightCm) || 0,
                        ageYears: Number(draft.ageYears) || 0,
                        goalWeightLow: Number(draft.goalWeightLow) || 0,
                        goalWeightHigh: Number(draft.goalWeightHigh) || 0,
                        goalBFLow: Number(draft.goalBFLow) || 0,
                        goalBFHigh: Number(draft.goalBFHigh) || 0,
                      };
                      onSaveSettings(cleaned);
                      setEditing(false);
                    }}>{t("저장", "Save")}</PrimaryButton>
                  </div>
                </div>
              )}
            </Card>
          ),

          weekPlan: (
            <>
              <Card>
                <SectionTitle right={<span style={{ fontSize: 12, color: theme.textFaint }}>{t("요일 탭해서 수정", "Tap a day to edit")}</span>}>{t("이번 주 플랜", "This Week's Plan")}</SectionTitle>
                <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
                  {weekPlan.map((d, i) => {
                    const isToday = i === todayIdx;
                    const done = doneMap[i];
                    const color = d.kind === "lift" ? theme.lift : d.kind === "run" ? theme.run : theme.rest;
                    const label = d.kind === "lift" ? (programs.find((p) => p.id === d.programId)?.name || "?") : d.kind === "run" ? (d.runLabel === "S.R" ? "Short" : d.runLabel === "L.R" ? "Long" : (d.runLabel || t("런", "Run"))) : "Rest";
                    return (
                      <button key={i} onClick={() => setEditingDayIdx(editingDayIdx === i ? null : i)}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                        <div style={{ fontSize: 12, color: isToday ? theme.text : theme.textFaint, fontWeight: isToday ? 700 : 500 }}>{WEEKDAY_LABELS[lang][i]}</div>
                        <div style={{
                          width: "100%", aspectRatio: "1", borderRadius: 12,
                          background: done ? color : "transparent",
                          border: `1.5px solid ${editingDayIdx === i ? theme.text : color}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          boxShadow: isToday ? `0 0 0 2px ${theme.bg}, 0 0 0 3px ${color}` : "none",
                        }}>
                          {done ? <Check size={13} color={d.kind === "lift" ? theme.heroText : "#FBFAF2"} /> : (d.kind === "lift" ? <Dumbbell size={13} color={color} /> : d.kind === "run" ? <Activity size={13} color={color} /> : null)}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textFaint, textAlign: "center" }}>{label}</div>
                      </button>
                    );
                  })}
                </div>
              </Card>

              {editingDayIdx !== null && (
                <DayEditorPanel
                  dayIdx={editingDayIdx}
                  weekPlan={weekPlan}
                  setWeekPlan={setWeekPlan}
                  programs={programs}
                  setPrograms={setPrograms}
                  onClose={() => setEditingDayIdx(null)}
                />
              )}
            </>
          ),

          steps: <StepCountCard />,

          dayLog: <DayLogCard key={todayStr()} dayLogs={dayLogs} setDayLogs={setDayLogs} />,

          maintenance: (
            <Card>
              <SectionTitle right={<span style={{ fontSize: 12, color: theme.textFaint }}>{settings.acceptedTdee ? t("승인된 보정 적용", "Accepted calibration") : (engine ? t("DietEngine 기반", "DietEngine-based") : t("최근 14일 실측", "Last 14d observed"))}</span>}>
                <Flame size={11} style={{ verticalAlign: -1, marginRight: 4 }} color={theme.run} />
                {activeTarget
                  ? (activeTarget.blocked ? t("유지 칼로리", "Maintenance Calories") : { cut: t("오늘의 다이어트 칼로리", "Today's Cut Target"), maintain: t("오늘의 유지 칼로리", "Today's Maintain Target"), gain: t("오늘의 증량 칼로리", "Today's Gain Target") }[activeTarget.mode])
                  : t("유지 칼로리", "Maintenance Calories")}
              </SectionTitle>
              {effectiveTdee ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {activeTarget?.blocked && (
                    <div style={{ fontSize: 12, color: theme.danger, lineHeight: 1.5, fontWeight: 700 }}>
                      {t("⚠ 설정에 표시하신 건강 상태 때문에 다이어트 목표 칼로리를 자동으로 제공하지 않아요. 대신 유지 칼로리를 보여드려요 — 필요하면 전문가와 상담해주세요.", "⚠ Because of the health context noted in Settings, an automated cut target isn't offered here — showing maintenance calories instead. Please check with a professional if a specific plan is needed.")}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums", fontFamily: FONT_STACK }}>
                      {activeTarget ? Math.round(activeTarget.target) : effectiveTdee}
                    </span>
                    <span style={{ fontSize: 12, color: theme.textDim }}>{t("kcal/일 (목표)", "kcal/day (target)")}</span>
                  </div>
                  <Stat label={t("유지 칼로리(TDEE)", "Maintenance (TDEE)")} value={`${effectiveTdee} kcal`} />
                  {engine ? (
                    <>
                      <Stat label={t("기초대사량(BMR)", "BMR")} value={`${Math.round(engine.bmr)} kcal`} />
                      <Stat label={t("보정 상태", "Calibration")} value={settings.acceptedTdee ? t(`승인됨 (${settings.calibrationAcceptedCount || 1}회)`, `Accepted (${settings.calibrationAcceptedCount || 1}x)`) : (engine.calibration.eligible ? t("제안 검토 가능 (유지칼로리 탭)", "Proposal available (Maintenance tab)") : t("데이터 더 필요", "Need more data"))} />
                    </>
                  ) : (
                    <>
                      <Stat label={t("평균 섭취", "Avg Intake")} value={`${observed.avgCal} kcal`} />
                      <Stat label={t("체중 변화", "Weight Change")} value={`${observed.weightChange > 0 ? "+" : ""}${observed.weightChange.toFixed(1)} kg / ${observed.days.toFixed(0)}${t("일", "d")}`} />
                    </>
                  )}
                  {!engine && (
                    <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>
                      {t("나이·키 설정하면 첫날부터 정확해져요.", "Set age/height for an accurate estimate from day one.")}
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState text={t("데이터가 더 필요해요 — 나이·키를 설정하면 바로 추정할 수 있어요.", "Need more data — or set age/height for an instant estimate.")} />
              )}
            </Card>
          ),
        };

        const cardLabels = {
          goalProgress: t("목표까지 진행률", "Progress to Goal"),
          weekPlan: t("이번 주 플랜", "This Week's Plan"),
          steps: t("오늘의 걸음수", "Today's Steps"),
          dayLog: t("데일리 로그", "Day Log"),
          maintenance: t("유지 칼로리", "Maintenance Calories"),
        };

        const savedOrder = settings.dashboardCardOrder || DEFAULT_CARD_ORDER;
        const order = [...savedOrder, ...DEFAULT_CARD_ORDER.filter((id) => !savedOrder.includes(id))];
        const moveCard = (id, dir) => {
          const arr = [...order];
          const idx = arr.indexOf(id);
          const newIdx = idx + dir;
          if (newIdx < 0 || newIdx >= arr.length) return;
          [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
          onSaveSettings({ ...settings, dashboardCardOrder: arr });
        };

        return (
          <>
            {!reorderMode && !settings.reorderHintDismissed && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 2px 4px" }}>
                <span style={{ fontSize: 12, color: theme.textFaint, fontStyle: "italic", fontFamily: FONT_STACK }}>
                  {t("팁: 카드를 길게 눌러 순서를 바꿀 수 있어요", "Tip: long-press a card to reorder it")}
                </span>
                <button onClick={() => onSaveSettings({ ...settings, reorderHintDismissed: true })}
                  style={{ background: "none", border: "none", color: theme.textFaint, cursor: "pointer", padding: 4, flexShrink: 0 }}>
                  <X size={12} />
                </button>
              </div>
            )}
            {reorderMode && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: theme.textFaint }}>{t("카드를 길게 눌러서 계속 옮길 수 있어요", "Long-press any card to keep rearranging")}</span>
                <button onClick={() => setReorderMode(false)}
                  style={{
                    background: tint(theme.lift, 0.16), border: `1px solid ${theme.lift}`, color: theme.lift,
                    cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 12,
                  }}>
                  {t("완료", "Done")}
                </button>
              </div>
            )}
            {order.map((id, idx) => (
              <div key={id}
                onTouchStart={longPressTouchStart} onTouchMove={longPressTouchMove} onTouchEnd={cancelLongPress}
                onMouseDown={beginLongPress} onMouseUp={cancelLongPress} onMouseLeave={cancelLongPress}
              >
                {reorderMode && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: theme.surfaceRaised, border: `1px solid ${theme.border}`,
                    borderRadius: 12, padding: "6px 10px", marginBottom: 6,
                  }}>
                    <span style={{ fontSize: 12, color: theme.textDim, display: "flex", alignItems: "center", gap: 6 }}>
                      <GripVertical size={13} color={theme.textFaint} /> {cardLabels[id]}
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => moveCard(id, -1)} disabled={idx === 0}
                        style={{ background: "none", border: "none", color: idx === 0 ? theme.border : theme.text, cursor: idx === 0 ? "default" : "pointer", padding: 4 }}>
                        <ChevronUp size={15} />
                      </button>
                      <button onClick={() => moveCard(id, 1)} disabled={idx === order.length - 1}
                        style={{ background: "none", border: "none", color: idx === order.length - 1 ? theme.border : theme.text, cursor: idx === order.length - 1 ? "default" : "pointer", padding: 4 }}>
                        <ChevronDown size={15} />
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {cardBlocks[id]}
                </div>
              </div>
            ))}
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: theme.textDim }}>{label}</span>
      <span style={{ color: theme.text, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/* ---------------------------------------------------------
   WORKOUTS TAB
--------------------------------------------------------- */
// Render full-screen flows at document.body level. The tab carousel uses a CSS
// transform, which otherwise turns `position: fixed` descendants into clipped
// children of the sliding track on mobile.
function FullscreenPortal({ children, scrollable = false, accent }) {
  const theme = useTheme();
  const overlay = (
    <div data-no-tab-swipe="true" style={{
      position: "fixed", inset: 0, zIndex: 1000, background: theme.bg,
      display: "flex", flexDirection: "column", boxSizing: "border-box",
      borderTop: `3px solid ${accent || theme.lift}`,
      paddingTop: "max(18px, env(safe-area-inset-top))",
      paddingRight: "max(18px, env(safe-area-inset-right))",
      paddingBottom: "max(18px, env(safe-area-inset-bottom))",
      paddingLeft: "max(18px, env(safe-area-inset-left))",
      overflowY: scrollable ? "auto" : "hidden",
    }}>
      {children}
    </div>
  );
  return typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay;
}

function ExecutionHeader({ eyebrow, title, meta, onClose, accent }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, paddingBottom: 14, marginBottom: 18, borderBottom: `1px solid ${theme.border}` }}>
      <div>
        <div style={{ color: accent || theme.lift, fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>{eyebrow}</div>
        <div style={{ color: theme.text, fontSize: 22, lineHeight: 1.1, fontWeight: 800 }}>{title}</div>
        {meta && <div style={{ color: theme.textDim, fontSize: 12.5, marginTop: 6 }}>{meta}</div>}
      </div>
      {onClose && <IconBtn onClick={onClose} label="Close"><X size={19} /></IconBtn>}
    </div>
  );
}

// Guided, step-by-step lift session: one set at a time, with an automatic
// rest timer between sets and progressive overload built in (target reps
// climb weekly per the exercise's own repRange, weight bumps up once the
// rep ceiling is hit). Produces a workout entry in exactly the same shape
// as the manual editor, so the history/summary view doesn't need to know
// which path was used to log it.
function GuidedLiftSession({ program, onFinish, onCancel, initialDraft }) {
  const { t } = useLang();
  const theme = useTheme();

  const restoringRef = useRef(!!initialDraft);
  const [setupDone, setSetupDone] = useState(initialDraft?.setupDone ?? false);
  const [restSeconds, setRestSeconds] = useState(initialDraft?.restSeconds ?? 90);
  const [weightIncrement, setWeightIncrement] = useState(initialDraft?.weightIncrement ?? 2.5);
  const [warmupSets, setWarmupSets] = useState(initialDraft?.warmupSets ?? 1);

  const [poMap, setPoMap] = useState(null); // { [key]: { weight, cycleStart } }
  useEffect(() => {
    (async () => {
      const stored = await loadKey("progressiveOverload", {});
      setPoMap(stored || {});
    })();
  }, []);

  // Flat plan: one entry per set across every exercise (warmup + working).
  const plan = useMemo(() => {
    if (!poMap) return [];
    const items = [];
    (program.exercises || []).forEach((ex) => {
      const { startReps, maxReps } = parseRepRange(ex.repRange);
      const key = poStateKey(program.id, ex.name);
      const poEntry = poMap[key];
      const targetReps = currentTargetReps(poEntry, startReps, maxReps);
      const workingWeight = poEntry?.weight ?? null;
      const workingCount = Math.max(1, Math.round(Number(ex.sets)) || 1);
      for (let i = 0; i < warmupSets; i++) {
        items.push({ exName: ex.name, muscle: ex.muscle, repRange: ex.repRange, isWarmup: true, targetReps: null, suggestedWeight: workingWeight != null ? Math.round((workingWeight * 0.6) / 2.5) * 2.5 : null });
      }
      for (let i = 0; i < workingCount; i++) {
        items.push({ exName: ex.name, muscle: ex.muscle, repRange: ex.repRange, isWarmup: false, targetReps, suggestedWeight: workingWeight, isLastWorking: i === workingCount - 1, key, startReps, maxReps });
      }
    });
    return items;
  }, [poMap, program, warmupSets]);

  const [stepIdx, setStepIdx] = useState(initialDraft?.stepIdx ?? 0);
  const [phase, setPhase] = useState(initialDraft?.phase ?? "logging"); // 'logging' | 'resting' | 'finished'
  const [weightInput, setWeightInput] = useState(initialDraft?.weightInput ?? "");
  const [repsInput, setRepsInput] = useState(initialDraft?.repsInput ?? "");
  const [log, setLog] = useState(initialDraft?.log ?? []); // [{ name, repRange, muscle, sets: [{weight, reps}] }]
  const [restRemaining, setRestRemaining] = useState(() => {
    if (initialDraft?.restEndsAt) return Math.max(0, Math.ceil((new Date(initialDraft.restEndsAt) - new Date()) / 1000));
    return initialDraft?.restRemaining ?? 0;
  });
  const [restEndsAt, setRestEndsAt] = useState(initialDraft?.restEndsAt || null);
  const [notes, setNotes] = useState(initialDraft?.notes ?? "");
  const [startTime] = useState(() => initialDraft?.startTime || new Date().toISOString());
  const poUpdatesRef = useRef({});

  const current = plan[stepIdx];
  const exerciseNames = useMemo(() => [...new Set(plan.map((item) => item.exName))], [plan]);
  const currentExerciseNumber = current ? exerciseNames.indexOf(current.exName) + 1 : 0;

  useEffect(() => {
    if (restoringRef.current) { restoringRef.current = false; return; }
    if (current) {
      setWeightInput(current.suggestedWeight != null ? String(current.suggestedWeight) : "");
      setRepsInput("");
    }
  }, [stepIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!setupDone || phase === "finished") return;
    saveKey("guidedSessionDraft", {
      date: todayStr(), programId: program.id, programName: program.name,
      setupDone, restSeconds, weightIncrement, warmupSets,
      stepIdx, phase, weightInput, repsInput, log, restRemaining, restEndsAt, notes, startTime,
    });
  }, [setupDone, restSeconds, weightIncrement, warmupSets, stepIdx, phase, weightInput, repsInput, log, restRemaining, restEndsAt, notes, startTime, program.id, program.name]);

  // Date-backed rest timer: survives app backgrounding better than decrementing state blindly.
  useEffect(() => {
    if (phase !== "resting") return;
    const tick = () => {
      const remaining = restEndsAt ? Math.max(0, Math.ceil((new Date(restEndsAt) - new Date()) / 1000)) : restRemaining;
      setRestRemaining(remaining);
      if (remaining <= 0) {
        haptic();
        advance();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, restEndsAt]);

  const logCurrentSet = () => {
    if (!weightInput || !repsInput || !current) return;
    setLog((prev) => {
      const next = [...prev];
      let group = next.find((g) => g.name === current.exName);
      if (!group) {
        group = { name: current.exName, repRange: current.repRange, muscle: current.muscle, sets: [] };
        next.push(group);
      }
      group.sets = [...group.sets, { weight: weightInput, reps: repsInput }];
      return next;
    });
    // Progressive overload: only the last working set of an exercise
    // decides whether this exercise's weight should bump next time.
    if (!current.isWarmup && current.isLastWorking) {
      const achieved = Number(repsInput) >= current.targetReps && current.targetReps >= current.maxReps;
      if (achieved) {
        const newWeight = (Number(weightInput) || 0) + weightIncrement;
        poUpdatesRef.current[current.key] = { weight: newWeight, cycleStart: todayStr() };
      } else if (!poMap[current.key]) {
        // First time doing this exercise in guided mode — seed the PO
        // state from whatever weight was actually used, so next time has
        // a starting point even without a bump yet.
        poUpdatesRef.current[current.key] = { weight: Number(weightInput) || 0, cycleStart: poMap[current.key]?.cycleStart || todayStr() };
      }
    }
    if (current.isWarmup || restSeconds <= 0) {
      advance();
    } else {
      const endsAt = new Date(Date.now() + restSeconds * 1000).toISOString();
      setPhase("resting");
      setRestRemaining(restSeconds);
      setRestEndsAt(endsAt);
      scheduleRestTimerNotification(restSeconds, t("휴식 끝!", "Rest's over!"), t("다음 세트 시작할 시간이에요.", "Time for the next set."));
    }
  };

  const advance = () => {
    cancelRestTimerNotification();
    if (stepIdx + 1 >= plan.length) {
      finishSession();
    } else {
      setRestEndsAt(null);
      setStepIdx((v) => v + 1);
      setPhase("logging");
    }
  };
  const skipRest = () => { setRestEndsAt(new Date().toISOString()); setRestRemaining(0); };

  const finishSession = async () => {
    // Persist progressive-overload updates gathered along the way.
    const updates = poUpdatesRef.current;
    if (Object.keys(updates).length > 0) {
      const merged = { ...poMap, ...updates };
      await saveKey("progressiveOverload", merged);
    }
    setPhase("finished");
  };

  const saveAndClose = () => {
    deleteKey("guidedSessionDraft");
    onFinish({
      date: todayStr(), type: "lift", subtype: program.name,
      startTime, endTime: new Date().toISOString(),
      duration: "", distance: "", hr: "", notes,
      exercises: log,
    });
  };

  if (!setupDone) {
    return (
      <FullscreenPortal scrollable accent={theme.lift}>
        <ExecutionHeader eyebrow={t("가이드 세션", "Guided session")} title={program.name} meta={t("세션 설정", "Session setup")} onClose={onCancel} accent={theme.lift} />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 8 }}>{t("세트 사이 휴식 시간", "Rest between sets")}</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[0, 30, 60, 90, 120, 180, 300, 600].map((s) => (
                <button key={s} onClick={() => setRestSeconds(s)}
                  style={{
                    padding: "7px 10px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${restSeconds === s ? theme.lift : theme.border}`,
                    background: restSeconds === s ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
                  }}>
                  {s === 0 ? t("없음", "None") : s < 60 ? `${s}${t("초", "s")}` : `${s / 60}${t("분", "m")}`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 8 }}>{t("목표 반복 도달 시 증량 단위", "Weight increment on progression")}</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[1, 2.5, 5].map((w) => (
                <button key={w} onClick={() => setWeightIncrement(w)}
                  style={{
                    flex: 1, padding: "9px 4px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${weightIncrement === w ? theme.lift : theme.border}`,
                    background: weightIncrement === w ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
                  }}>
                  +{w}kg
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <input
                type="range" min={1} max={10} step={0.25}
                value={weightIncrement}
                onChange={(e) => setWeightIncrement(Number(e.target.value))}
                style={{ width: "100%", accentColor: theme.lift }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: theme.textFaint, marginTop: 2 }}>
                <span>+1kg</span><span style={{ color: theme.text, fontWeight: 800 }}>+{Number(weightIncrement).toFixed(weightIncrement % 1 ? 2 : 0)}kg</span><span>+10kg</span>
              </div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 8 }}>{t("웜업 세트 수 (운동마다)", "Warmup sets (per exercise)")}</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[0, 1, 2, 3].map((n) => (
                <button key={n} onClick={() => setWarmupSets(n)}
                  style={{
                    flex: 1, padding: "9px 4px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${warmupSets === n ? theme.lift : theme.border}`,
                    background: warmupSets === n ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
                  }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <PrimaryButton onClick={() => setSetupDone(true)}>{t("운동 시작", "Start Workout")}</PrimaryButton>
      </FullscreenPortal>
    );
  }

  if (phase === "finished") {
    return (
      <FullscreenPortal accent={theme.lift}>
        <ExecutionHeader eyebrow={t("세션 완료", "Session complete")} title={t("수고하셨어요!", "Great work!")} meta={`${program.name} · ${log.reduce((s, g) => s + g.sets.length, 0)} ${t("세트 완료", "sets logged")}`} accent={theme.lift} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, overflowY: "auto", flex: 1 }}>
          {log.map((g) => (
            <Card key={g.name} style={{ padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 4 }}>{g.name}</div>
              <div style={{ fontSize: 12, color: theme.textDim }}>{g.sets.map((s) => `${s.weight}×${s.reps}`).join(", ")}</div>
            </Card>
          ))}
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={t("메모 (선택)", "Notes (optional)")}
          style={{ ...getInputStyle(theme), minHeight: 50, resize: "vertical", fontFamily: "inherit", marginBottom: 12 }} />
        <PrimaryButton onClick={saveAndClose}>{t("저장", "Save")}</PrimaryButton>
      </FullscreenPortal>
    );
  }

  if (!current) return null;

  return (
    <FullscreenPortal accent={theme.lift}>
      <ExecutionHeader
        eyebrow={t(`운동 ${currentExerciseNumber}/${exerciseNames.length}`, `Exercise ${currentExerciseNumber}/${exerciseNames.length}`)}
        title={current.exName}
        meta={t(`세트 ${stepIdx + 1}/${plan.length} · ${current.isWarmup ? "웜업" : `목표 ${current.targetReps}회`}`, `Set ${stepIdx + 1}/${plan.length} · ${current.isWarmup ? "Warmup" : `Target ${current.targetReps} reps`}`)}
        onClose={onCancel}
        accent={theme.lift}
      />

      <div style={{ position: "sticky", top: 0, zIndex: 2, background: theme.bg, borderBottom: `1px solid ${theme.border}`, padding: "8px 0", marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, color: theme.textDim, fontVariantNumeric: "tabular-nums" }}>
        <span>{t(`운동 ${currentExerciseNumber}/${exerciseNames.length}`, `Exercise ${currentExerciseNumber}/${exerciseNames.length}`)}</span>
        <strong style={{ color: theme.text }}>{t(`세트 ${stepIdx + 1}/${plan.length}`, `Set ${stepIdx + 1}/${plan.length}`)}</strong>
      </div>
      {phase === "logging" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 }}>
          <div style={{ textAlign: "left", borderLeft: `3px solid ${theme.lift}`, paddingLeft: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: theme.textFaint, letterSpacing: "0.08em" }}>{current.isWarmup ? t("웜업 세트", "WARMUP SET") : t("현재 세트", "CURRENT SET")}</div>
            <div style={{ fontSize: 14, color: theme.textDim, marginTop: 4 }}>{current.isWarmup ? t("움직임과 자세를 확인하세요", "Check movement and form") : t(`목표 ${current.targetReps}회 · ${current.repRange}`, `Target ${current.targetReps} reps · ${current.repRange}`)}</div>
          </div>
          {(() => { const prior = log.find((g) => g.name === current.exName)?.sets?.at(-1); return prior ? <StatusCallout tone="lift" style={{ fontSize: 13 }}>{t("방금 기록", "Last set")} · <strong>{prior.weight} kg × {prior.reps}</strong></StatusCallout> : null; })()}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 4 }}>{t("무게(kg)", "Weight (kg)")}</div>
              <TextInput type="number" step="0.5" value={weightInput} onChange={(e) => setWeightInput(e.target.value)}
                style={{ width: "100%", minHeight: 66, fontSize: 24, textAlign: "center", fontWeight: 800, fontVariantNumeric: "tabular-nums" }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 4 }}>{t("횟수", "Reps")}</div>
              <TextInput type="number" value={repsInput} onChange={(e) => setRepsInput(e.target.value)}
                style={{ width: "100%", minHeight: 66, fontSize: 24, textAlign: "center", fontWeight: 800, fontVariantNumeric: "tabular-nums" }} />
            </div>
          </div>
          <PrimaryButton onClick={logCurrentSet} disabled={!weightInput || !repsInput} style={{ minHeight: 68, fontSize: 17, marginTop: "auto" }}>{t("세트 완료", "Complete Set")}</PrimaryButton>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: theme.textFaint, letterSpacing: "0.1em" }}>{t("휴식 타이머", "REST TIMER")}</div>
          <div style={{ fontSize: 64, fontWeight: 850, color: theme.lift, fontVariantNumeric: "tabular-nums", lineHeight: 0.95 }}>
            {Math.floor(restRemaining / 60)}:{String(restRemaining % 60).padStart(2, "0")}
          </div>
          <div style={{ width: "100%", borderLeft: `3px solid ${theme.lift}`, padding: "8px 12px", background: tint(theme.lift, 0.06), fontSize: 13, color: theme.textDim }}>{t("다음 세트:", "NEXT SET:")} <strong style={{ color: theme.text }}>{plan[stepIdx + 1]?.exName || t("완료", "Finish")}</strong></div>
          <button onClick={skipRest} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 12, padding: "9px 16px", color: theme.textDim, cursor: "pointer", fontSize: 13 }}>
            {t("건너뛰기", "Skip Rest")}
          </button>
        </div>
      )}
    </FullscreenPortal>
  );
}

function ExerciseSetEditor({ exercises, setExercises, workouts, programName }) {
  const { t } = useLang();
  const theme = useTheme();

  const lastSession = useMemo(() => {
    if (!workouts || !programName) return null;
    const matches = workouts
      .filter((w) => w.subtype === programName && w.exercises && w.exercises.length > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    return matches[0] || null;
  }, [workouts, programName]);

  const lastExerciseFor = (exName) => lastSession?.exercises.find((e) => e.name === exName) || null;

  const updateSet = (exIdx, setIdx, field, value) => {
    const next = exercises.map((ex, i) => {
      if (i !== exIdx) return ex;
      return { ...ex, sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, [field]: value } : s)) };
    });
    setExercises(next);
  };
  const addSet = (exIdx) => {
    const next = exercises.map((ex, i) => (i === exIdx ? { ...ex, sets: [...ex.sets, { weight: "", reps: "" }] } : ex));
    setExercises(next);
  };
  const removeSet = (exIdx, setIdx) => {
    const next = exercises.map((ex, i) => (i === exIdx ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) } : ex));
    setExercises(next);
  };
  // Loads the entire last session's numbers for this exercise at once —
  // same explicit, tappable pattern as the nutrition tab's "yesterday" chips,
  // instead of a second, different (ghost-placeholder) repeat-entry idiom.
  const loadLastSession = (exIdx, exName) => {
    const lastEx = lastExerciseFor(exName);
    if (!lastEx) return;
    const next = exercises.map((ex, i) => {
      if (i !== exIdx) return ex;
      const newSets = ex.sets.map((s, j) => {
        const last = lastEx.sets[j];
        return last ? { weight: last.weight ? String(last.weight) : "", reps: last.reps ? String(last.reps) : "" } : s;
      });
      return { ...ex, sets: newSets };
    });
    setExercises(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {exercises.map((ex, exIdx) => {
        const lastEx = lastExerciseFor(ex.name);
        return (
        <Card key={ex.name} style={{ background: theme.surfaceRaised, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: lastEx ? 2 : 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{ex.name}</div>
            <div style={{ fontSize: 12, color: theme.textFaint }}>{t("목표 반복", "Target reps")} {ex.repRange}</div>
          </div>
          {lastEx && (
            <button onClick={() => loadLastSession(exIdx, ex.name)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                background: "none", border: `1px dashed ${theme.lift}`, borderRadius: 12, cursor: "pointer",
                padding: "6px 9px", marginBottom: 8, textAlign: "left",
              }}>
              <span style={{ fontSize: 12, color: theme.lift }}>
                {t(`저번(${fmtDate(lastSession.date)}): `, `Last time (${fmtDate(lastSession.date)}): `)}
                {lastEx.sets.map((s, i) => `${s.weight || "-"}×${s.reps || "-"}`).join(", ")}
              </span>
              <span style={{ fontSize: 12, color: theme.lift, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{t("불러오기", "Load")}</span>
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ex.sets.map((s, setIdx) => (
              <div key={setIdx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: theme.textFaint, width: 34, flexShrink: 0 }}>{t("세트", "Set")}{setIdx + 1}</span>
                <TextInput type="number" placeholder="kg" value={s.weight}
                  onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value)} />
                <span style={{ fontSize: 12, color: theme.textFaint }}>×</span>
                <TextInput type="number" placeholder="reps" value={s.reps}
                  onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)} />
                <button onClick={() => removeSet(exIdx, setIdx)} disabled={ex.sets.length <= 1}
                  style={{
                    background: "none", border: "none", flexShrink: 0, padding: 4,
                    color: ex.sets.length <= 1 ? theme.border : theme.danger,
                    cursor: ex.sets.length <= 1 ? "not-allowed" : "pointer",
                  }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => addSet(exIdx)}
            style={{
              marginTop: 8, background: "none", border: `1px dashed ${theme.border}`, borderRadius: 12,
              padding: "6px 10px", color: theme.textDim, fontSize: 12, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%",
            }}>
            <Plus size={12} /> {t("세트 추가", "Add Set")}
          </button>
        </Card>
        );
      })}
    </div>
  );
}

function formatExerciseSummary(exercises) {
  if (!exercises || exercises.length === 0) return null;
  return exercises
    .map((ex) => {
      const filled = ex.sets.filter((s) => s.weight || s.reps);
      if (filled.length === 0) return null;
      const setsStr = filled.map((s) => `${s.weight || "-"}kg×${s.reps || "-"}`).join(", ");
      return `${ex.name} ${setsStr}`;
    })
    .filter(Boolean);
}

// Backward-compatible duration: prefer the legacy typed-in minutes field
// if present (older entries), otherwise derive it from real start/end
// timestamps (new guided/timer-based entries).
function getDurationMinutes(w) {
  if (!w) return null;
  if (w.duration !== "" && w.duration != null) {
    const n = Number(w.duration);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (w.startTime && w.endTime) {
    const mins = (new Date(w.endTime) - new Date(w.startTime)) / 60000;
    return Number.isFinite(mins) && mins >= 0 ? mins : null;
  }
  return null;
}

function getDurationMin(w) {
  const mins = getDurationMinutes(w);
  return mins == null ? null : Math.round(mins);
}

function durationPartsFromMinutes(value) {
  const totalSec = Math.max(0, Math.round((Number(value) || 0) * 60));
  return { min: String(Math.floor(totalSec / 60)), sec: String(totalSec % 60) };
}

function durationMinutesFromParts(min, sec) {
  const totalSec = (Number(min) || 0) * 60 + (Number(sec) || 0);
  return totalSec > 0 ? +(totalSec / 60).toFixed(4) : "";
}

function formatWorkoutDuration(w, t) {
  const mins = getDurationMinutes(w);
  if (mins == null) return "";
  if (w.type === "run") {
    const totalSec = Math.max(0, Math.round(mins * 60));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s > 0 ? t(`${m}분 ${s}초`, `${m}m ${s}s`) : t(`${m}분`, `${m}m`);
  }
  return t(`${Math.round(mins)}분`, `${Math.round(mins)}min`);
}

// Sums logged sets per muscle group over a recent window, from any lift
// workout's exercises that carry a muscle tag. Exercises logged before
// muscle tagging existed (or custom ones without a tag picked) are simply
// skipped rather than guessed at.
function computeMuscleVolume(workouts, days) {
  const cutoff = nowDate();
  cutoff.setDate(cutoff.getDate() - days);
  const volume = {};
  workouts.forEach((w) => {
    if (w.type !== "lift" || !w.exercises || new Date(w.date) < cutoff) return;
    w.exercises.forEach((ex) => {
      if (!ex.muscle || !ex.sets) return;
      volume[ex.muscle] = (volume[ex.muscle] || 0) + ex.sets.length;
    });
  });
  return volume;
}

function BodyMuscleDiagram({ volume, view, theme }) {
  const max = Math.max(1, ...Object.values(volume));
  const colorFor = (muscle) => {
    const v = volume[muscle] || 0;
    if (v === 0) return theme.surfaceRaised;
    return mixHex(theme.surfaceRaised, theme.lift, 0.25 + Math.min(1, v / max) * 0.75);
  };
  // Simplified anatomical silhouette — approximate regions, not a medical
  // illustration, just enough to read "which areas got trained."
  return (
    <svg width="100%" height="220" viewBox="0 0 130 220">
      {/* head */}
      <circle cx="65" cy="18" r="14" fill={theme.border} />
      {view === "front" ? (
        <>
          <ellipse cx="38" cy="40" rx="10" ry="11" fill={colorFor("shoulders")} />
          <ellipse cx="92" cy="40" rx="10" ry="11" fill={colorFor("shoulders")} />
          <rect x="46" y="34" width="38" height="42" rx="10" fill={colorFor("chest")} />
          <rect x="50" y="76" width="30" height="34" rx="8" fill={colorFor("core")} />
          <rect x="28" y="44" width="14" height="50" rx="7" fill={colorFor("biceps")} />
          <rect x="88" y="44" width="14" height="50" rx="7" fill={colorFor("biceps")} />
          <rect x="42" y="112" width="20" height="58" rx="9" fill={colorFor("quads")} />
          <rect x="68" y="112" width="20" height="58" rx="9" fill={colorFor("quads")} />
        </>
      ) : (
        <>
          <ellipse cx="38" cy="40" rx="10" ry="11" fill={colorFor("shoulders")} />
          <ellipse cx="92" cy="40" rx="10" ry="11" fill={colorFor("shoulders")} />
          <rect x="44" y="32" width="42" height="48" rx="10" fill={colorFor("back")} />
          <rect x="28" y="46" width="14" height="46" rx="7" fill={colorFor("triceps")} />
          <rect x="88" y="46" width="14" height="46" rx="7" fill={colorFor("triceps")} />
          <rect x="46" y="112" width="38" height="24" rx="8" fill={colorFor("glutes")} />
          <rect x="42" y="138" width="20" height="34" rx="9" fill={colorFor("hamstrings")} />
          <rect x="68" y="138" width="20" height="34" rx="9" fill={colorFor("hamstrings")} />
          <rect x="44" y="174" width="18" height="34" rx="8" fill={colorFor("calves")} />
          <rect x="68" y="174" width="18" height="34" rx="8" fill={colorFor("calves")} />
        </>
      )}
    </svg>
  );
}

function MuscleGroupBreakdown({ workouts }) {
  const { t } = useLang();
  const theme = useTheme();
  const [view, setView] = useState("front");
  const [days, setDays] = useState(7);
  const volume = useMemo(() => computeMuscleVolume(workouts, days), [workouts, days]);
  const hasAnyData = Object.keys(volume).length > 0;

  return (
    <Card>
      <SectionTitle right={
        <div style={{ display: "flex", gap: 5 }}>
          {[7, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                padding: "4px 9px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                border: `1px solid ${days === d ? theme.lift : theme.border}`,
                background: days === d ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
              }}>
              {d === 7 ? t("주간", "Week") : t("월간", "Month")}
            </button>
          ))}
        </div>
      }>
        {t("부위별 운동량", "Muscle Group Volume")}
      </SectionTitle>
      {!hasAnyData ? (
        <div style={{ fontSize: 12, color: theme.textFaint, lineHeight: 1.6 }}>
          {t("근육 부위가 태그된 운동 기록이 아직 없어요. 프로그램 편집에서 운동마다 부위를 지정해보세요.", "No muscle-tagged workout data yet. Assign a muscle group to each exercise in the program editor.")}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 8 }}>
            {["front", "back"].map((v) => (
              <button key={v} onClick={() => setView(v)}
                style={{
                  padding: "5px 14px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${view === v ? theme.lift : theme.border}`,
                  background: view === v ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
                }}>
                {v === "front" ? t("앞면", "Front") : t("뒷면", "Back")}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 140 }}>
              <BodyMuscleDiagram volume={volume} view={view} theme={theme} />
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, justifyContent: "center" }}>
            {Object.entries(volume).sort((a, b) => b[1] - a[1]).map(([muscle, sets]) => (
              <div key={muscle} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: theme.textDim }}>
                <div style={{ width: 8, height: 8, borderRadius: 12, background: mixHex(theme.surfaceRaised, theme.lift, 0.6) }} />
                {MUSCLE_GROUPS[muscle]?.label(t) || muscle} · {sets}{t("세트", " sets")}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// Start/stop timer for runs — records real start/end timestamps rather
// than a typed-in duration guess. Ticks live while a run is in progress.
function RunTimerControl({ form, setForm, prominent = false }) {
  const { t } = useLang();
  const theme = useTheme();
  const [, forceTick] = useState(0);
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (form.type !== "run" || form.startTime || form.endTime) return;
      const draft = await loadKey("runSessionDraft", null);
      if (mounted && draft && draft.date === todayStr() && draft.form?.startTime && !draft.form?.endTime) {
        setForm({ ...form, ...draft.form });
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.type !== "run") return;
    if (form.startTime && !form.endTime) saveKey("runSessionDraft", { date: todayStr(), form });
    if (form.endTime) deleteKey("runSessionDraft");
  }, [form]);

  useEffect(() => {
    if (!form.startTime || form.endTime) return;
    const timer = setInterval(() => forceTick((v) => v + 1), 1000);
    const onVisible = () => forceTick((v) => v + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [form.startTime, form.endTime]);

  const elapsedSec = form.startTime
    ? Math.max(0, Math.round(((form.endTime ? new Date(form.endTime) : new Date()) - new Date(form.startTime)) / 1000))
    : 0;
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const timerText = `${mm}:${ss}`;
  const start = () => setForm({ ...form, startTime: new Date().toISOString(), endTime: "" });
  const stop = () => {
    const endedAt = new Date();
    const seconds = form.startTime ? Math.max(0, Math.round((endedAt - new Date(form.startTime)) / 1000)) : 0;
    setForm({
      ...form,
      endTime: endedAt.toISOString(),
      duration: seconds > 0 ? +(seconds / 60).toFixed(4) : "",
      durationMin: String(Math.floor(seconds / 60)),
      durationSec: String(seconds % 60),
    });
  };
  const reset = () => { deleteKey("runSessionDraft"); setForm({ ...form, startTime: "", endTime: "" }); };

  const actionStyle = {
    width: "100%", minHeight: prominent ? 64 : 42, padding: prominent ? "16px 18px" : "10px",
    borderRadius: 12, border: "none", color: "#FBFAF2",
    fontWeight: 800, fontSize: prominent ? 17 : 13, cursor: "pointer", letterSpacing: "0.01em",
  };

  if (!form.startTime) {
    return (
      <button onClick={start} style={{ ...actionStyle, background: theme.run }}>
        {t("러닝 시작", "Start Run")}
      </button>
    );
  }

  if (!form.endTime) {
    return (
      <div style={{ display: "flex", flexDirection: prominent ? "column" : "row", alignItems: prominent ? "stretch" : "center", gap: prominent ? 14 : 10 }}>
        <div style={{ textAlign: prominent ? "center" : "left", borderBottom: prominent ? `1px solid ${tint(theme.run, 0.35)}` : "none", paddingBottom: prominent ? 12 : 0 }}>
          {prominent && <div style={{ fontSize: 12, fontWeight: 800, color: theme.run, letterSpacing: "0.1em", marginBottom: 8 }}>{t("러닝 진행 중", "RUN IN PROGRESS")}</div>}
          <span style={{ fontSize: prominent ? 56 : 18, fontWeight: 850, color: theme.text, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {timerText}
          </span>
        </div>
        <button onClick={stop} style={{ ...actionStyle, flex: prominent ? "none" : 1, background: theme.danger }}>
          {t("러닝 종료", "Stop Run")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: prominent ? "column" : "row", alignItems: "center", gap: prominent ? 10 : 10 }}>
      <span style={{ fontSize: prominent ? 28 : 16, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums" }}>
        {timerText} {t("기록됨", "recorded")}
      </span>
      <button onClick={reset} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 12, padding: prominent ? "10px 14px" : "6px 10px", color: theme.textDim, fontSize: prominent ? 13 : 11.5, cursor: "pointer" }}>
        {t("재설정", "Reset")}
      </button>
    </div>
  );
}

function WorkoutsTab({ workouts, setWorkouts, programs, initialMode, initialEditId, editSignal }) {
  const { lang, t } = useLang();
  const theme = useTheme();
  const firstProgramName = programs[0]?.name || "기타";
  const findProgram = (name) => programs.find((p) => p.name === name);
  const exercisesFor = (name) => makeExercisesFromPlan(findProgram(name)?.exercises, lang);

  const [form, setForm] = useState(
    initialMode === "run"
      ? { date: todayStr(), type: "run", subtype: "S.R", duration: "", durationMin: "", durationSec: "", distance: "", hr: "", notes: "", exercises: [] }
      : { date: todayStr(), type: "lift", subtype: firstProgramName, duration: "", distance: "", hr: "", notes: "", exercises: exercisesFor(firstProgramName) }
  );
  const [showForm, setShowForm] = useState(false);
  const [showProgramPicker, setShowProgramPicker] = useState(false);
  const [guidedProgram, setGuidedProgram] = useState(null);
  const [guidedDraft, setGuidedDraft] = useState(null);
  const [quickLift, setQuickLift] = useState({ date: todayStr(), subtype: firstProgramName, duration: "", notes: "" });
  const [quickRun, setQuickRun] = useState({ date: todayStr(), subtype: "S.R", durationMin: "", durationSec: "", distance: "", hr: "", notes: "" });

  const saveQuickLift = () => {
    if (!quickLift.duration && !quickLift.notes.trim()) return;
    const subtype = quickLift.subtype || firstProgramName;
    setWorkouts([{ id: uid(), date: quickLift.date || todayStr(), type: "lift", subtype, duration: quickLift.duration, distance: "", hr: "", notes: quickLift.notes, exercises: [] }, ...workouts]);
    setQuickLift({ date: todayStr(), subtype: firstProgramName, duration: "", notes: "" });
  };
  const saveQuickRun = () => {
    const duration = durationMinutesFromParts(quickRun.durationMin, quickRun.durationSec);
    if (!duration && !quickRun.distance && !quickRun.notes.trim()) return;
    setWorkouts([{ id: uid(), date: quickRun.date || todayStr(), type: "run", subtype: quickRun.subtype || "S.R", duration, distance: quickRun.distance, hr: quickRun.hr, notes: quickRun.notes, exercises: [] }, ...workouts]);
    setQuickRun({ date: todayStr(), subtype: "S.R", durationMin: "", durationSec: "", distance: "", hr: "", notes: "" });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const draft = await loadKey("guidedSessionDraft", null);
      if (mounted) setGuidedDraft(draft && draft.date === todayStr() ? draft : null);
    })();
    return () => { mounted = false; };
  }, []);
  const startGuidedProgram = (program, draft = null) => {
    setGuidedDraft(draft);
    setGuidedProgram(program);
    setShowProgramPicker(false);
  };
  const cancelGuidedSession = async () => {
    setGuidedProgram(null);
    const draft = await loadKey("guidedSessionDraft", null);
    setGuidedDraft(draft && draft.date === todayStr() ? draft : null);
  };
  const discardGuidedDraft = async () => {
    await deleteKey("guidedSessionDraft");
    setGuidedDraft(null);
  };
  const finishGuidedSession = (entry) => {
    deleteKey("guidedSessionDraft");
    setGuidedDraft(null);
    setWorkouts([{ id: uid(), ...entry }, ...workouts]);
    setGuidedProgram(null);
  };

  const liftSubtypes = [...programs.map((p) => p.name), "기타"];
  const runSubtypes = ["S.R", "L.R", "기타"];

  const chooseType = (type) => {
    const subtype = type === "lift" ? firstProgramName : "S.R";
    setForm({ ...form, type, subtype, exercises: type === "lift" ? exercisesFor(subtype) : [] });
  };
  const chooseSubtype = (subtype) => {
    setForm({ ...form, subtype, exercises: form.type === "lift" ? exercisesFor(subtype) : [] });
  };

  const [editingId, setEditingId] = useState(null);
  const save = () => {
    const normalizedForm = form.type === "run"
      ? { ...form, duration: durationMinutesFromParts(form.durationMin, form.durationSec) || form.duration }
      : form;
    if (editingId) {
      setWorkouts(workouts.map((w) => (w.id === editingId ? { ...w, ...normalizedForm } : w)));
    } else {
      const entry = { id: uid(), ...normalizedForm };
      setWorkouts([entry, ...workouts]);
    }
    setForm({ date: todayStr(), type: "lift", subtype: firstProgramName, duration: "", distance: "", hr: "", notes: "", exercises: exercisesFor(firstProgramName) });
    setEditingId(null);
    setShowForm(false);
    deleteKey("workoutDraft");
  };
  const startEdit = (entry) => {
    const parts = entry.type === "run" ? durationPartsFromMinutes(getDurationMinutes(entry) || 0) : { min: "", sec: "" };
    setShowProgramPicker(false);
    setGuidedProgram(null);
    setForm({
      date: entry.date, type: entry.type, subtype: entry.subtype, duration: entry.duration || "",
      durationMin: parts.min, durationSec: parts.sec,
      startTime: entry.startTime || "", endTime: entry.endTime || "",
      distance: entry.distance || "", hr: entry.hr || "", notes: entry.notes || "",
      exercises: entry.exercises || (entry.type === "lift" ? exercisesFor(entry.subtype) : []),
    });
    setEditingId(entry.id);
    setShowForm(true);
  };
  const consumedEditRef = useRef(null);
  useEffect(() => {
    if (!initialEditId) return;
    const requestKey = `${initialEditId}:${editSignal || 0}`;
    if (consumedEditRef.current === requestKey) return;
    const entry = workouts.find((w) => w.id === initialEditId);
    if (!entry) return;
    consumedEditRef.current = requestKey;
    startEdit(entry);
  }, [initialEditId, editSignal, workouts]);

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const remove = (id) => setConfirmDeleteId(id);
  const confirmRemove = () => {
    setWorkouts(workouts.filter((w) => w.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  // Auto-save a draft of an in-progress strength workout so nothing is
  // lost if the app gets closed/backgrounded between sets at the gym —
  // logging one set at a time shouldn't require finishing the whole
  // session before it's safe to put the phone away. Skipped while editing
  // an already-saved entry (that's not the "mid-workout" case this protects).
  useEffect(() => {
    if (!showForm || form.type !== "lift" || editingId) return;
    saveKey("workoutDraft", { date: todayStr(), form });
  }, [form, showForm, editingId]);

  const [search, setSearch] = useState("");
  const sorted = [...workouts]
    .filter((w) => !search.trim() || `${w.subtype} ${w.notes || ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  const showExerciseEditor = form.type === "lift" && findProgram(form.subtype);

  return (
    <>
    {confirmDeleteId && (
      <ConfirmDialog message={t("이 운동 기록을 삭제할까요? 되돌릴 수 없어요.", "Delete this workout entry? This can't be undone.")} onConfirm={confirmRemove} onCancel={() => setConfirmDeleteId(null)} />
    )}
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {guidedProgram && (
        <GuidedLiftSession program={guidedProgram} initialDraft={guidedDraft && guidedDraft.programId === guidedProgram.id ? guidedDraft : null} onFinish={finishGuidedSession} onCancel={cancelGuidedSession} />
      )}
      {!showForm && !guidedProgram && (
        <div>
          {!showProgramPicker ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {initialMode === "run" && (
                <Card variant="feature" style={{ padding: 18, color: theme.text }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.09em", color: theme.textDim }}>CARDIO SESSION</div>
                  <div style={{ fontFamily: FONT_STACK, fontSize: 23, fontWeight: 750, marginTop: 5 }}>{t("러닝 시작", "Start cardio")}</div>
                  <div style={{ marginTop: 12, paddingTop: 11, borderTop: `1px solid ${tint(theme.heroText, 0.25)}` }}>
                    <RunTimerControl form={form} setForm={setForm} prominent />
                  </div>
                </Card>
              )}
              {guidedDraft && (() => {
                const draftProgram = programs.find((p) => p.id === guidedDraft.programId) || programs.find((p) => p.name === guidedDraft.programName);
                return draftProgram ? (
                  <Card style={{ borderColor: tint(theme.lift, 0.45), background: tint(theme.lift, 0.08) }}>
                    <SectionTitle>{t("진행 중인 가이드 세션", "In-progress guided session")}</SectionTitle>
                    <div style={{ fontSize: 13, color: theme.textDim, lineHeight: 1.45, marginBottom: 12 }}>{draftProgram.name} · {t("중간에 멈춘 세션을 이어갈 수 있어요.", "Resume where you left off.")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                      <PrimaryButton onClick={() => startGuidedProgram(draftProgram, guidedDraft)}>{t("이어하기", "Resume")}</PrimaryButton>
                      <button onClick={discardGuidedDraft} style={{ minHeight: 46, padding: "0 14px", borderRadius: 14, border: `1px solid ${theme.danger}`, background: "transparent", color: theme.danger, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{t("삭제", "Delete")}</button>
                    </div>
                  </Card>
                ) : null;
              })()}
              {initialMode !== "run" && (
                <Card variant="feature" style={{ padding: 18, color: theme.text }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.09em", color: theme.textDim }}>TODAY'S WORKOUT</div>
                  <div style={{ fontFamily: FONT_STACK, fontSize: 23, fontWeight: 750, marginTop: 5 }}>{firstProgramName}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 11, borderTop: `1px solid ${tint(theme.heroText, 0.25)}` }}>
                    <span style={{ fontSize: 12, color: theme.textDim }}>{t("준비된 프로그램", "Prepared program")}</span>
                    <button onClick={() => startGuidedProgram(programs[0])} style={{ minHeight: 46, padding: "0 14px", borderRadius: 14, border: "none", background: theme.lift, color: "#FBFAF2", fontSize: 14, fontWeight: 800, cursor: "pointer" }}><Dumbbell size={16} style={{ verticalAlign: -3, marginRight: 5 }} />{t("시작", "Start")}</button>
                  </div>
                </Card>
              )}

              {initialMode === "run" ? (
                <Card>
                  <SectionTitle>{t("수동 유산소 기록", "Manual cardio log")}</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <Field label={t("날짜", "Date")}><TextInput type="date" value={quickRun.date} onChange={(e) => setQuickRun({ ...quickRun, date: e.target.value })} /></Field>
                    <Field label={t("종류", "Type")}><Select value={quickRun.subtype} onChange={(e) => setQuickRun({ ...quickRun, subtype: e.target.value })}>{runSubtypes.map((s) => <option key={s} value={s}>{s === "기타" ? t("기타", "Other") : s === "S.R" ? "Short" : s === "L.R" ? "Long" : s}</option>)}</Select></Field>
                    <Field label={t("거리", "Distance")}><UnitInput type="number" step="0.1" unit="km" value={quickRun.distance} onChange={(e) => setQuickRun({ ...quickRun, distance: e.target.value })} placeholder="5" /></Field>
                    <Field label={t("분", "Minutes")}><UnitInput type="number" inputMode="numeric" unit={t("분", "min")} value={quickRun.durationMin} onChange={(e) => setQuickRun({ ...quickRun, durationMin: e.target.value })} placeholder="30" /></Field>
                    <Field label={t("초", "Seconds")}><UnitInput type="number" inputMode="numeric" unit={t("초", "sec")} value={quickRun.durationSec} onChange={(e) => setQuickRun({ ...quickRun, durationSec: e.target.value })} placeholder="00" /></Field>
                    <Field label={t("평균 심박", "Avg HR")}><UnitInput type="number" inputMode="numeric" unit="bpm" value={quickRun.hr} onChange={(e) => setQuickRun({ ...quickRun, hr: e.target.value })} placeholder="135" /></Field>
                    <Field label={t("메모", "Notes")}><TextInput value={quickRun.notes} onChange={(e) => setQuickRun({ ...quickRun, notes: e.target.value })} placeholder={t("선택", "Optional")} /></Field>
                  </div>
                  <PrimaryButton onClick={saveQuickRun} disabled={!durationMinutesFromParts(quickRun.durationMin, quickRun.durationSec) && !quickRun.distance && !quickRun.notes.trim()}>{t("수동 기록 저장", "Save manual log")}</PrimaryButton>
                </Card>
              ) : (
                <Card>
                  <SectionTitle>{t("수동 운동 기록", "Manual training log")}</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <Field label={t("날짜", "Date")}><TextInput type="date" value={quickLift.date} onChange={(e) => setQuickLift({ ...quickLift, date: e.target.value })} /></Field>
                    <Field label={t("프로그램", "Program")}><Select value={quickLift.subtype} onChange={(e) => setQuickLift({ ...quickLift, subtype: e.target.value })}>{liftSubtypes.map((s) => <option key={s} value={s}>{s === "기타" ? t("기타", "Other") : s}</option>)}</Select></Field>
                    <Field label={t("시간", "Duration")}><UnitInput type="number" inputMode="numeric" unit={t("분", "min")} value={quickLift.duration} onChange={(e) => setQuickLift({ ...quickLift, duration: e.target.value })} placeholder="45" /></Field>
                    <Field label={t("메모", "Notes")}><TextInput value={quickLift.notes} onChange={(e) => setQuickLift({ ...quickLift, notes: e.target.value })} placeholder={t("선택", "Optional")} /></Field>
                  </div>
                  <PrimaryButton onClick={saveQuickLift} disabled={!quickLift.duration && !quickLift.notes.trim()}>{t("수동 기록 저장", "Save manual log")}</PrimaryButton>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <SectionTitle right={<IconBtn onClick={() => setShowProgramPicker(false)}><X size={16} /></IconBtn>}>{t("프로그램 선택", "Choose Program")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {programs.map((p) => (
                  <button key={p.id} onClick={() => startGuidedProgram(p)}
                    style={{ padding: 12, borderRadius: 12, border: `1px solid ${theme.border}`, background: "none", color: theme.text, cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: 600 }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
      <AnimatedBox>
        {!showForm ? null : (
          <Card data-dirty-form={editingId || form.type === "lift" || !!form.startTime || !!form.calories ? "true" : "false"}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <SectionTitle>{editingId ? t("기록 수정", "Edit Entry") : t("새 기록", "New Entry")}</SectionTitle>
            <span data-form-cancel="true" style={{ display: "contents" }}><IconBtn onClick={() => { setShowForm(false); setEditingId(null); }}><X size={16} /></IconBtn></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {form.type === "run" && (
              <div style={{
                padding: 14, borderRadius: 12, background: tint(theme.run, 0.12),
                border: `1px solid ${tint(theme.run, 0.42)}`, display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: theme.run, letterSpacing: "0.04em" }}>
                  {t("러닝 세션", "RUN SESSION")}
                </div>
                <RunTimerControl form={form} setForm={setForm} prominent />
              </div>
            )}
            {(form.type !== "run" || form.endTime || form.duration) && (<>
            {form.type === "lift" && (
              <div style={{ display: "flex", gap: 6 }}>
                {liftSubtypes.map((s) => (
                  <button key={s} onClick={() => chooseSubtype(s)}
                    style={{
                      flex: 1, padding: "8px 4px", borderRadius: 12, fontSize: 12.5,
                      border: `1px solid ${form.subtype === s ? theme.lift : theme.border}`,
                      background: form.subtype === s ? tint(theme.lift, 0.16) : "transparent",
                      color: theme.text, cursor: "pointer",
                    }}>
                    {s === "기타" ? t("기타", "Other") : s}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label={t("날짜", "Date")}><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              {form.type === "run" && (
                <Field label={t("종류", "Type")}>
                  <Select value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}>
                    {runSubtypes.map((s) => <option key={s} value={s}>{s === "기타" ? t("기타", "Other") : s === "S.R" ? "Short" : s === "L.R" ? "Long" : s}</option>)}
                  </Select>
                </Field>
              )}
              {form.type !== "run" && (
                <Field label={t("시간(분)", "Duration (min)")}><UnitInput type="number" inputMode="numeric" unit={t("분", "min")} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="45" /></Field>
              )}
              {form.type === "run" && (
                <>
                  <Field label={t("분", "Minutes")}><UnitInput type="number" inputMode="numeric" unit={t("분", "min")} value={form.durationMin || ""} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} placeholder="30" /></Field>
                  <Field label={t("초", "Seconds")}><UnitInput type="number" inputMode="numeric" unit={t("초", "sec")} value={form.durationSec || ""} onChange={(e) => setForm({ ...form, durationSec: e.target.value })} placeholder="00" /></Field>
                  <Field label={t("거리(km)", "Distance (km)")}><UnitInput type="number" step="0.1" unit="km" value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} placeholder="5" /></Field>
                  <Field label={t("평균 심박", "Avg Heart Rate")}><UnitInput type="number" inputMode="numeric" unit="bpm" value={form.hr} onChange={(e) => setForm({ ...form, hr: e.target.value })} placeholder="135" /></Field>
                </>
              )}
            </div>

            {showExerciseEditor && (
              <ExerciseSetEditor
                exercises={form.exercises}
                setExercises={(exercises) => setForm({ ...form, exercises })}
                workouts={workouts}
                programName={form.subtype}
              />
            )}

            <Field label={t("메모", "Notes")}>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={form.type === "lift" ? t("컨디션, 폼 체크 등", "Condition, form notes, etc.") : t("예: 컨버세이셔널 페이스 유지", "e.g. Kept a conversational pace")}
                style={{ ...getInputStyle(theme), minHeight: 50, resize: "vertical", fontFamily: "inherit" }} />
            </Field>
            <PrimaryButton onClick={save}>{editingId ? t("수정 완료", "Save Changes") : t("저장", "Save")}</PrimaryButton>
            </>)}
          </div>
        </Card>
        )}
      </AnimatedBox>

      {workouts.length > 0 && <MuscleGroupBreakdown workouts={workouts} />}

      {workouts.length > 3 && (
        <div style={{ position: "relative" }}>
          <Search size={14} color={theme.textFaint} style={{ position: "absolute", left: 12, top: 11 }} />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("운동/메모 검색", "Search workouts/notes")} style={{ paddingLeft: 32 }} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 && <EmptyState icon={Dumbbell} text={search ? t("검색 결과가 없습니다.", "No matching entries.") : t("아직 기록이 없습니다. 첫 세션을 기록해보세요.", "No entries yet. Log your first session.")} actionLabel={null} onAction={null} />}
        {sorted.map((w) => {
          const exSummary = formatExerciseSummary(w.exercises);
          return (
            <Card key={w.id} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 12, flexShrink: 0,
                    background: w.type === "lift" ? tint(theme.lift, 0.16) : tint(theme.run, 0.16),
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {w.type === "lift" ? <Dumbbell size={16} color={theme.lift} /> : <Activity size={16} color={theme.run} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>{w.subtype === "기타" ? t("기타", "Other") : w.subtype === "S.R" ? "Short" : w.subtype === "L.R" ? "Long" : w.subtype}</div>
                    <div style={{ fontSize: 12, color: theme.textDim }}>
                      {fmtDate(w.date)} {formatWorkoutDuration(w, t) ? `· ${formatWorkoutDuration(w, t)}` : ""} {w.type === "run" && w.distance ? `· ${w.distance}km` : ""} {w.type === "run" && w.hr ? `· ${t("평균", "avg")} ${w.hr}bpm` : ""}
                    </div>
                    {exSummary && exSummary.length > 0 && (
                      <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                        {exSummary.map((line, i) => <div key={i}>{line}</div>)}
                      </div>
                    )}
                    {w.notes && <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 4 }}>{w.notes}</div>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <IconBtn onClick={() => startEdit(w)}><Pencil size={14} /></IconBtn>
                  <IconBtn danger onClick={() => remove(w.id)}><Trash2 size={14} /></IconBtn>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
    </>
  );
}

/* ---------------------------------------------------------
   NUTRITION TAB
--------------------------------------------------------- */
function FoodCalculator({ date, customFoods, setCustomFoods, onAdd }) {
  const { lang, t } = useLang();
  const theme = useTheme();
  const foodName = (f) => (lang === "en" && f.nameEn ? f.nameEn : f.name);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [grams, setGrams] = useState(100);
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({ name: "", cal: "", p: "", c: "", f: "" });

  const allFoods = useMemo(() => [...customFoods, ...FOOD_DB], [customFoods]);
  const filtered = useMemo(() => {
    if (!query.trim()) return allFoods.slice(0, 8);
    const q = query.trim().toLowerCase();
    return allFoods.filter((f) => f.name.toLowerCase().includes(q) || (f.nameEn && f.nameEn.toLowerCase().includes(q))).slice(0, 8);
  }, [query, allFoods]);

  const scale = grams ? (Number(grams) || 0) / 100 : 0;
  const computed = selected ? {
    cal: Math.round(selected.cal * scale),
    p: +(selected.p * scale).toFixed(1),
    c: +(selected.c * scale).toFixed(1),
    f: +(selected.f * scale).toFixed(1),
  } : null;

  const saveCustom = () => {
    if (!custom.name || !custom.cal) return;
    const entry = { name: custom.name, cal: +custom.cal || 0, p: +custom.p || 0, c: +custom.c || 0, f: +custom.f || 0 };
    setCustomFoods([entry, ...customFoods]);
    setSelected(entry);
    setCustom({ name: "", cal: "", p: "", c: "", f: "" });
    setShowCustom(false);
    setQuery(entry.name);
  };

  const addToLog = () => {
    if (!selected || !computed) return;
    onAdd({
      date, meal: `${foodName(selected)} ${grams}g`,
      calories: computed.cal, protein: computed.p, carbs: computed.c, fat: computed.f,
    });
    setSelected(null); setQuery(""); setGrams(100);
  };

  return (
    <Card>
      <SectionTitle right={<Calculator size={14} color={theme.textFaint} />}>{t("음식 칼로리 계산기", "Food Calorie Calculator")}</SectionTitle>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <div style={{ position: "relative" }}>
          <Search size={14} color={theme.textFaint} style={{ position: "absolute", left: 10, top: 11 }} />
          <TextInput
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            placeholder={t("음식 검색 (예: 닭가슴살, 백미밥...)", "Search food (e.g. chicken breast, rice...)")}
            style={{ paddingLeft: 30 }}
          />
        </div>
        {query && !selected && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {filtered.map((f, i) => (
              <button key={i} onClick={() => { setSelected(f); setQuery(foodName(f)); }}
                style={{ textAlign: "left", background: theme.surfaceRaised, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "8px 10px", color: theme.text, fontSize: 12.5, cursor: "pointer" }}>
                {foodName(f)} <span style={{ color: theme.textFaint }}>· {f.cal}kcal/100g</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ fontSize: 12, color: theme.textFaint, padding: "6px 2px" }}>
                {t("검색 결과 없음 — 아래에서 직접 추가할 수 있어요.", "No results — you can add it manually below.")}
              </div>
            )}
          </div>
        )}
      </div>

      {!showCustom ? (
        <button onClick={() => setShowCustom(true)} style={{ background: "none", border: "none", color: theme.textDim, fontSize: 12, cursor: "pointer", padding: "2px 0 10px", textAlign: "left" }}>
          + {t("목록에 없는 음식 직접 추가하기", "Add a food not in the list")}
        </button>
      ) : (
        <Card style={{ background: theme.surfaceRaised, marginBottom: 10, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: theme.textDim }}>{t("새 음식 (100g 기준 영양성분)", "New Food (per 100g)")}</div>
            <IconBtn onClick={() => setShowCustom(false)}><X size={13} /></IconBtn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <TextInput placeholder={t("음식 이름", "Food name")} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            </div>
            <TextInput type="number" placeholder={t("칼로리(kcal)", "Calories (kcal)")} value={custom.cal} onChange={(e) => setCustom({ ...custom, cal: e.target.value })} />
            <TextInput type="number" placeholder={t("단백질(g)", "Protein (g)")} value={custom.p} onChange={(e) => setCustom({ ...custom, p: e.target.value })} />
            <TextInput type="number" placeholder={t("탄수화물(g)", "Carbs (g)")} value={custom.c} onChange={(e) => setCustom({ ...custom, c: e.target.value })} />
            <TextInput type="number" placeholder={t("지방(g)", "Fat (g)")} value={custom.f} onChange={(e) => setCustom({ ...custom, f: e.target.value })} />
          </div>
          <PrimaryButton onClick={saveCustom} disabled={!custom.name || !custom.cal}>{t("목록에 저장", "Save to List")}</PrimaryButton>
        </Card>
      )}

      {selected && computed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Field label={t("섭취량(g)", "Amount (g)")}>
            <TextInput type="number" value={grams} onChange={(e) => setGrams(e.target.value)} />
          </Field>
          <div style={{ background: theme.surfaceRaised, borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <div><span style={{ color: theme.run, fontWeight: 700 }}>{computed.cal}</span> <span style={{ color: theme.textFaint }}>kcal</span></div>
            <div>{t("단백", "P")} <b style={{ color: theme.text }}>{computed.p}</b>g</div>
            <div>{t("탄수", "C")} <b style={{ color: theme.text }}>{computed.c}</b>g</div>
            <div>{t("지방", "F")} <b style={{ color: theme.text }}>{computed.f}</b>g</div>
          </div>
          <PrimaryButton onClick={addToLog}><Plus size={15} /> {t("식단 기록에 추가", "Add to Log")}</PrimaryButton>
        </div>
      )}
    </Card>
  );
}

function MacroBar({ label, consumed, target, lightMode, theme }) {
  const { t } = useLang();
  const consumedPct = target > 0 ? (consumed / target) * 100 : 0;
  const over = consumed > target;
  const remainingPct = Math.max(0, 100 - consumedPct);
  const isLightHero = theme.heroText?.toUpperCase() === "#FBFAF2";
  const trackColor = lightMode ? (isLightHero ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)") : theme.surfaceRaised;
  const fillColor = over ? theme.danger : (lightMode ? theme.heroText : theme.lift);
  const labelColor = lightMode ? theme.heroTextDim : theme.textDim;
  const valueColor = over ? theme.danger : (lightMode ? theme.heroTextDim : theme.textFaint);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: labelColor }}>{label}</span>
        <span style={{ color: valueColor, fontVariantNumeric: "tabular-nums", fontWeight: over ? 700 : 400 }}>
          {over ? `+${Math.round(consumed - target)}g ${t("초과", "over")}` : `${Math.round(target - consumed)}g ${t("남음", "left")}`}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 12, background: trackColor, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 12, transition: "width 0.2s ease",
          width: `${over ? 100 : remainingPct}%`, background: fillColor,
        }} />
      </div>
    </div>
  );
}

function NutritionTab({ settings, bodycomp, workouts, nutrition, setNutrition, customFoods, setCustomFoods, recentAvgSteps, resetSignal }) {
  const { t } = useLang();
  const theme = useTheme();
  const [form, setForm] = useState({ date: todayStr(), meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null });
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("calc"); // 'calc' | 'manual'
  const [targetFlipped, setTargetFlipped] = useState(false);
  const [targetFlipAnim, setTargetFlipAnim] = useState(false);

  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    setShowForm(false);
    setMode("calc");
    setTargetFlipped(false);
    setTargetFlipAnim(false);
    setEditingId(null);
    setForm({ date: todayStr(), meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null });
  }, [resetSignal]);

  const save = () => {
    if (!form.calories) return;
    // If the person didn't explicitly pick a quality chip, infer a
    // reasonable default: having macros filled in suggests a more careful
    // entry than a bare calorie guess.
    const quality = form.quality ?? (form.protein || form.carbs || form.fat ? 0.8 : 0.55);
    if (editingId) {
      setNutrition(nutrition.map((n) => (n.id === editingId ? { ...n, ...form, quality } : n)));
    } else {
      setNutrition([{ id: uid(), ...form, quality }, ...nutrition]);
    }
    setForm({ date: form.date, meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null });
    setEditingId(null);
    setShowForm(false);
  };
  const startEdit = (entry) => {
    setForm({
      date: entry.date, meal: entry.meal || "", calories: String(entry.calories || ""),
      protein: entry.protein ? String(entry.protein) : "", carbs: entry.carbs ? String(entry.carbs) : "",
      fat: entry.fat ? String(entry.fat) : "", quality: entry.quality ?? null,
    });
    setEditingId(entry.id);
    setMode("manual");
    setShowForm(true);
  };
  // Food-calculator entries come from a structured food database with
  // known gram amounts, so they're treated as the highest-quality tier.
  const addComputed = (entry) => setNutrition([{ id: uid(), ...entry, quality: 1.0 }, ...nutrition]);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const remove = (id) => setConfirmDeleteId(id);
  const confirmRemove = () => {
    setNutrition(nutrition.filter((n) => n.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  // Most recent PAST day (not today) with logged meals — "same as
  // yesterday" quick-fill, similar in spirit to the workout editor's
  // "last time" reference.
  const recentDayMeals = useMemo(() => {
    const today = todayStr();
    const pastDates = [...new Set(nutrition.filter((n) => n.date !== today).map((n) => n.date))].sort((a, b) => b.localeCompare(a));
    const mostRecent = pastDates[0];
    if (!mostRecent) return null;
    return { date: mostRecent, meals: nutrition.filter((n) => n.date === mostRecent) };
  }, [nutrition]);

  const quickFillFrom = (entry) => {
    setForm({
      date: todayStr(), meal: entry.meal || "", calories: String(entry.calories || ""),
      protein: entry.protein ? String(entry.protein) : "", carbs: entry.carbs ? String(entry.carbs) : "",
      fat: entry.fat ? String(entry.fat) : "", quality: entry.quality ?? null,
    });
    setEditingId(null);
    setMode("manual");
    setShowForm(true);
  };

  const byDate = useMemo(() => {
    const map = {};
    nutrition.forEach((n) => {
      if (!map[n.date]) map[n.date] = [];
      map[n.date].push(n);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [nutrition]);

  // Today's target, resolved from the same mode/tier chosen on Home / Maintenance.
  const sortedBc = [...bodycomp].sort((a, b) => a.date.localeCompare(b.date));
  const currentWeight = sortedBc[sortedBc.length - 1]?.weight ?? (settings.startWeight || null);
  const currentBF = sortedBc[sortedBc.length - 1]?.bodyfat ?? null;
  const engine = useMemo(
    () => estimateTdeeEngine(settings, bodycomp, nutrition, workouts, currentWeight, recentAvgSteps),
    [settings, bodycomp, nutrition, workouts, currentWeight, recentAvgSteps]
  );
  const observed = useMemo(() => computeObservedTdee(bodycomp, nutrition, 14), [bodycomp, nutrition]);
  const effectiveTdee = settings.acceptedTdee ?? (engine ? engine.initialTdee : observed?.tdee ?? null);
  const dailyTarget = computeActiveTarget(settings, effectiveTdee, currentWeight, currentBF);

  const todayTotals = useMemo(() => {
    return nutrition.filter((n) => n.date === todayStr()).reduce((acc, i) => ({
      cal: acc.cal + (+i.calories || 0),
      p: acc.p + (+i.protein || 0),
      c: acc.c + (+i.carbs || 0),
      f: acc.f + (+i.fat || 0),
    }), { cal: 0, p: 0, c: 0, f: 0 });
  }, [nutrition]);

  const modeLabel = dailyTarget?.blocked ? t("유지", "Maintenance") : { cut: t("다이어트", "Cut"), maintain: t("유지어트", "Maintain"), gain: t("증량", "Gain") }[dailyTarget?.mode];

  return (
    <>
    {confirmDeleteId && (
      <ConfirmDialog message={t("이 식단 기록을 삭제할까요? 되돌릴 수 없어요.", "Delete this meal entry? This can't be undone.")} onConfirm={confirmRemove} onCancel={() => setConfirmDeleteId(null)} />
    )}
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ScreenHeader
        eyebrow={t("영양", "Eat")}
        title={t("EAT", "EAT")}
        subtitle={t("Fuel your goals.", "Fuel your goals.")}
        color={theme.eat || theme.lift}
      />
      {dailyTarget && (() => {
        const target = dailyTarget.target;
        const consumedCal = todayTotals.cal;
        const over = consumedCal > target;
        const remainingPct = Math.max(0, 100 - (consumedCal / target) * 100);
        const dailyHistory = byDate.slice(0, 14).map(([date, entries]) => ({
          date,
          cal: entries.reduce((s, e) => s + (+e.calories || 0), 0),
        }));
        return (
          <Card
            variant="feature"
            accent={theme.eat || theme.lift}
            onClick={() => {
              if (targetFlipAnim) return; // ignore rapid re-taps while a flip is already in progress
              setTargetFlipAnim(true);
              setTimeout(() => { setTargetFlipped((f) => !f); setTargetFlipAnim(false); }, 150);
            }}
            style={{
              background: targetFlipped ? theme.surface : `linear-gradient(135deg, ${tint(theme.eat || theme.lift, theme.isDark ? 0.16 : 0.12)}, ${theme.surface})`,
              border: `1px solid ${tint(theme.eat || theme.lift, 0.28)}`,
              borderTop: `4px solid ${theme.eat || theme.lift}`,
              position: "relative", padding: 16, cursor: "pointer",
              transition: "height 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), transform 0.15s ease-in-out",
              transform: targetFlipAnim ? "rotateY(90deg)" : "rotateY(0deg)",
            }}
          >
            {!targetFlipped ? (
              <div>
                <SectionTitle right={<span style={{ fontSize: 12, color: theme.textDim }}>{modeLabel}</span>}>
                  <span style={{ color: theme.text }}>{t("오늘의 목표", "Today's Target")}</span>
                </SectionTitle>
                {dailyTarget?.blocked && (
                  <div style={{ fontSize: 12, color: theme.text, background: "rgba(0,0,0,0.18)", borderRadius: 12, padding: "6px 8px", marginBottom: 8, fontWeight: 700, lineHeight: 1.4 }}>
                    {t("⚠ 건강 상태 설정으로 다이어트 목표 대신 유지 칼로리를 보여드려요.", "⚠ Showing maintenance calories instead of a cut target, based on your health settings.")}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 850, color: over ? theme.danger : theme.text, fontVariantNumeric: "tabular-nums" }}>
                    {over ? `+${Math.round(consumedCal - target)}` : Math.round(target - consumedCal)}
                  </span>
                  <span style={{ fontSize: 12, color: theme.textDim }}>{over ? t("kcal 초과", "kcal over") : t("kcal 남음", "kcal remaining")}</span>
                </div>
                <div style={{ height: 5, borderRadius: 0, background: theme.surfaceRaised, overflow: "hidden", marginBottom: 6 }}>
                  <div style={{
                    height: "100%", borderRadius: 12, transition: "width 0.2s ease",
                    width: `${over ? 100 : remainingPct}%`,
                    background: over ? theme.danger : theme.lift,
                  }} />
                </div>
                <div style={{ fontSize: 13, color: theme.textDim, marginBottom: 2 }}>
                  {t(`목표 ${Math.round(target)} · 섭취 ${Math.round(consumedCal)}`, `Target ${Math.round(target)} · Eaten ${Math.round(consumedCal)}`)}
                </div>
                <InsightLine>{over ? t(`오늘 목표보다 ${Math.round(consumedCal - target)} kcal 높은 상태예요.`, `${Math.round(consumedCal - target)} kcal above today’s target.`) : t(`오늘 기록에 ${Math.round(target - consumedCal)} kcal 여유가 남아 있어요.`, `${Math.round(target - consumedCal)} kcal remain for today.`)}</InsightLine>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <MacroBar label={t("단백질", "Protein")} consumed={todayTotals.p} target={dailyTarget.macros.proteinG} lightMode theme={theme} />
                  <MacroBar label={t("탄수화물", "Carbs")} consumed={todayTotals.c} target={dailyTarget.macros.carbG} lightMode theme={theme} />
                  <MacroBar label={t("지방", "Fat")} consumed={todayTotals.f} target={dailyTarget.macros.fatG} lightMode theme={theme} />
                </div>
              </div>
            ) : (
              <div onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
                <SectionTitle right={<span style={{ fontSize: 12, color: theme.textFaint }}>{t("탭해서 뒤집기", "Tap to flip back")}</span>}>
                  {t("일별 섭취 기록", "Daily Intake History")}
                </SectionTitle>
                {dailyHistory.length === 0 ? (
                  <EmptyState text={t("아직 기록이 없습니다.", "No entries yet.")} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {dailyHistory.map(({ date, cal }) => {
                      const dayOver = cal > target;
                      return (
                        <div key={date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${theme.border}` }}>
                          <span style={{ fontSize: 12.5, color: theme.textDim }}>{fmtDate(date)}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: dayOver ? theme.danger : theme.text, fontVariantNumeric: "tabular-nums" }}>
                            {Math.round(cal)} kcal
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })()}

      {recentDayMeals && (
        <div>
          <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.04em", marginBottom: 6 }}>
            {t(`저번 기록(${fmtDate(recentDayMeals.date)}) 그대로 추가`, `Quick-add from last logged day (${fmtDate(recentDayMeals.date)})`)}
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {recentDayMeals.meals.map((entry) => (
              <button key={entry.id} onClick={() => quickFillFrom(entry)}
                style={{
                  flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                  padding: "7px 10px", borderRadius: 12, border: `1px solid ${theme.border}`,
                  background: theme.surfaceRaised, color: theme.text, cursor: "pointer", minWidth: 88,
                }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{entry.meal || t("기록", "Entry")}</span>
                <span style={{ fontSize: 12, color: theme.textFaint }}>{entry.calories}kcal</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => { setMode("calc"); setShowForm(false); setEditingId(null); }}
          style={{ flex: 1, padding: 9, borderRadius: 12, fontSize: 12.5, border: `1px solid ${mode === "calc" ? theme.lift : theme.border}`, background: mode === "calc" ? tint(theme.lift, 0.16) : "transparent", color: theme.text, cursor: "pointer" }}>
          {t("음식 계산기", "Food Calculator")}
        </button>
        <button onClick={() => { setMode("manual"); setShowForm(true); setEditingId(null); }}
          style={{ flex: 1, padding: 9, borderRadius: 12, fontSize: 12.5, border: `1px solid ${mode === "manual" ? theme.lift : theme.border}`, background: mode === "manual" ? tint(theme.lift, 0.16) : "transparent", color: theme.text, cursor: "pointer" }}>
          {t("직접 입력", "Manual Entry")}
        </button>
      </div>

      <AnimatedBox>
        {mode === "calc" ? (
          <FoodCalculator date={form.date} customFoods={customFoods} setCustomFoods={setCustomFoods} onAdd={addComputed} />
        ) : (
          !showForm ? (
            <PrimaryButton onClick={() => setShowForm(true)}><Plus size={16} /> {t("식사 기록 추가", "Add Meal")}</PrimaryButton>
          ) : (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <SectionTitle>{t("새 식사", "New Meal")}</SectionTitle>
                <IconBtn onClick={() => setShowForm(false)}><X size={16} /></IconBtn>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label={t("날짜", "Date")}><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                  <Field label={t("식사명(선택)", "Meal name (optional)")}><TextInput value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })} placeholder={t("점심", "Lunch")} /></Field>
                  <Field label={t("단백질(g)", "Protein (g)")}><TextInput type="number" value={form.protein} onChange={(e) => {
                    const protein = e.target.value;
                    setForm({ ...form, protein, calories: autoCalories(protein, form.carbs, form.fat) });
                  }} placeholder="45" /></Field>
                  <Field label={t("탄수화물(g)", "Carbs (g)")}><TextInput type="number" value={form.carbs} onChange={(e) => {
                    const carbs = e.target.value;
                    setForm({ ...form, carbs, calories: autoCalories(form.protein, carbs, form.fat) });
                  }} placeholder="70" /></Field>
                  <Field label={t("지방(g)", "Fat (g)")}><TextInput type="number" value={form.fat} onChange={(e) => {
                    const fat = e.target.value;
                    setForm({ ...form, fat, calories: autoCalories(form.protein, form.carbs, fat) });
                  }} placeholder="18" /></Field>
                  <Field label={t("칼로리(kcal, 자동계산·수정가능)", "Calories (kcal, auto-calculated, editable)")}><TextInput type="number" value={form.calories} onChange={(e) => setForm({ ...form, calories: e.target.value })} placeholder="650" /></Field>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.04em", marginBottom: 6 }}>
                    {t("기록 신뢰도 (선택)", "Record Accuracy (optional)")}
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {[
                      { id: "weighed", q: 1.0, label: t("정확히 잼", "Weighed") },
                      { id: "mostly", q: 0.8, label: t("대략 기록", "Mostly logged") },
                      { id: "estimate", q: 0.55, label: t("외식/추정", "Restaurant/estimate") },
                    ].map((opt) => (
                      <button key={opt.id} onClick={() => setForm({ ...form, quality: opt.q })}
                        style={{
                          flex: 1, padding: "6px 2px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                          border: `1px solid ${form.quality === opt.q ? theme.lift : theme.border}`,
                          background: form.quality === opt.q ? tint(theme.lift, 0.16) : "transparent",
                          color: theme.text, fontWeight: form.quality === opt.q ? 700 : 500,
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <PrimaryButton onClick={save} disabled={!form.calories}>{editingId ? t("수정 완료", "Save Changes") : t("저장", "Save")}</PrimaryButton>
              </div>
            </Card>
          )
        )}
      </AnimatedBox>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {byDate.length === 0 && <EmptyState icon={Utensils} text={t("아직 식사 기록이 없습니다.", "No meals logged yet.")} />}
        {byDate.map(([date, items]) => {
          const totals = items.reduce((acc, i) => ({
            cal: acc.cal + (+i.calories || 0),
            p: acc.p + (+i.protein || 0),
            c: acc.c + (+i.carbs || 0),
            f: acc.f + (+i.fat || 0),
          }), { cal: 0, p: 0, c: 0, f: 0 });
          return (
            <Card key={date} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{fmtDate(date)}</div>
                <div style={{ fontSize: 12, color: theme.run, fontWeight: 700 }}>{totals.cal} kcal</div>
              </div>
              <div style={{ fontSize: 12, color: theme.textDim, marginBottom: 8 }}>
                {t("단백질", "Protein")} {totals.p}g · {t("탄수", "Carbs")} {totals.c}g · {t("지방", "Fat")} {totals.f}g
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {items.map((i) => (
                  <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, borderTop: `1px solid ${theme.border}`, paddingTop: 6 }}>
                    <span style={{ color: theme.textDim }}>{i.meal || t("기록", "Entry")} · {i.calories}kcal</span>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <IconBtn onClick={() => startEdit(i)}><Pencil size={13} /></IconBtn>
                      <IconBtn danger onClick={() => remove(i.id)}><Trash2 size={13} /></IconBtn>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
    </>
  );
}

/* ---------------------------------------------------------
   BODY COMP TAB
--------------------------------------------------------- */
function BodyCompTab({ bodycomp, setBodycomp }) {
  const { t } = useLang();
  const theme = useTheme();
  const [form, setForm] = useState({ date: todayStr(), weight: "", bodyfat: "", muscleMass: "", condition: "fasted" });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const save = () => {
    if (!form.weight) return;
    const entryData = {
      date: form.date, weight: +form.weight, bodyfat: form.bodyfat ? +form.bodyfat : null,
      muscleMass: form.muscleMass ? +form.muscleMass : null, condition: form.condition,
    };
    if (editingId) {
      setBodycomp(bodycomp.map((b) => (b.id === editingId ? { ...b, ...entryData } : b)));
    } else {
      setBodycomp([{ id: uid(), ...entryData }, ...bodycomp]);
    }
    setForm({ date: todayStr(), weight: "", bodyfat: "", muscleMass: "", condition: "fasted" });
    setEditingId(null);
    setShowForm(false);
  };
  const startEdit = (entry) => {
    setForm({
      date: entry.date, weight: String(entry.weight), bodyfat: entry.bodyfat != null ? String(entry.bodyfat) : "",
      muscleMass: entry.muscleMass != null ? String(entry.muscleMass) : "", condition: entry.condition || "fasted",
    });
    setEditingId(entry.id);
    setShowForm(true);
  };
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const remove = (id) => setConfirmDeleteId(id);
  const confirmRemove = () => {
    setBodycomp(bodycomp.filter((b) => b.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const chartData = [...bodycomp].sort((a, b) => a.date.localeCompare(b.date)).map((b) => ({
    date: fmtDate(b.date), weight: b.weight, bodyfat: b.bodyfat,
  }));
  const sorted = [...bodycomp].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
    {confirmDeleteId && (
      <ConfirmDialog message={t("이 체성분 기록을 삭제할까요? 되돌릴 수 없어요.", "Delete this measurement? This can't be undone.")} onConfirm={confirmRemove} onCancel={() => setConfirmDeleteId(null)} />
    )}
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <AnimatedBox>
        {!showForm ? (
          <PrimaryButton onClick={() => setShowForm(true)}><Plus size={16} /> {t("체성분 기록 추가", "Add Measurement")}</PrimaryButton>
        ) : (
          <Card data-dirty-form={showForm ? "true" : "false"}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <SectionTitle>{editingId ? t("측정 기록 수정", "Edit Measurement") : t("새 측정", "New Measurement")}</SectionTitle>
              <IconBtn onClick={() => { setShowForm(false); setEditingId(null); }}><X size={16} /></IconBtn>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <Field label={t("날짜", "Date")}><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label={t("체중(kg)", "Weight (kg)")}><TextInput type="number" step="0.1" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="102.9" /></Field>
              <Field label={t("체지방(%, 선택)", "Body Fat % (optional)")}><TextInput type="number" step="0.1" value={form.bodyfat} onChange={(e) => setForm({ ...form, bodyfat: e.target.value })} placeholder="30.5" /></Field>
              <Field label={t("근육량(kg, 선택)", "Muscle Mass (kg, optional)")}><TextInput type="number" step="0.1" value={form.muscleMass} onChange={(e) => setForm({ ...form, muscleMass: e.target.value })} placeholder="38.2" /></Field>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.04em", marginBottom: 6 }}>
                {t("측정 조건", "Measurement Condition")}
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {[
                  { id: "fasted", label: t("공복 아침", "Fasted AM") },
                  { id: "after_meal", label: t("식후", "After meal") },
                  { id: "after_training", label: t("운동 후", "After training") },
                  { id: "unknown", label: t("모름", "Unknown") },
                ].map((opt) => (
                  <button key={opt.id} onClick={() => setForm({ ...form, condition: opt.id })}
                    style={{
                      flex: 1, padding: "6px 2px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${form.condition === opt.id ? theme.lift : theme.border}`,
                      background: form.condition === opt.id ? tint(theme.lift, 0.16) : "transparent",
                      color: theme.text, fontWeight: form.condition === opt.id ? 700 : 500,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <PrimaryButton onClick={save} disabled={!form.weight}>{editingId ? t("수정 완료", "Save Changes") : t("저장", "Save")}</PrimaryButton>
          </Card>
        )}
      </AnimatedBox>

      {chartData.length >= 2 && (
        <Card>
          <SectionTitle>{t("체중 · 체지방 추이", "Weight · Body Fat Trend")}</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ left: -20, right: 10 }}>
              <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke={theme.textFaint} tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" stroke={theme.lift} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <YAxis yAxisId="right" orientation="right" stroke={theme.run} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: theme.surfaceRaised, border: `1px solid ${theme.border}`, borderRadius: 12, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="weight" name={t("체중", "Weight")} stroke={theme.lift} strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="bodyfat" name={t("체지방", "Body Fat")} stroke={theme.run} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 && <EmptyState icon={Scale} text={t("아직 측정 기록이 없습니다.", "No measurements yet.")} actionLabel={t("체성분 기록 추가", "Add Measurement")} onAction={() => setShowForm(true)} />}
        {sorted.map((b) => (
          <Card key={b.id} style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>{b.weight}kg{b.bodyfat ? ` · ${b.bodyfat}%` : ""}{b.muscleMass ? ` · ${t("근육", "SM")} ${b.muscleMass}kg` : ""}</div>
              <div style={{ fontSize: 12, color: theme.textDim }}>{fmtDate(b.date)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <IconBtn onClick={() => startEdit(b)}><Pencil size={14} /></IconBtn>
              <IconBtn danger onClick={() => remove(b.id)}><Trash2 size={14} /></IconBtn>
            </div>
          </Card>
        ))}
      </div>
    </div>
    </>
  );
}

/* ---------------------------------------------------------
   TDEE TAB
--------------------------------------------------------- */
// Shared "propose, don't silently apply" card — used for both TDEE
// calibration and activity-level proposals, so the two systems share one
// visual/interaction language instead of two separately-evolved designs.
function ProposalCard({ title, badge, eligible, children, ineligibleNote, onAccept, acceptLabel, onDismiss, dismissLabel }) {
  const theme = useTheme();
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  return (
    <Card style={eligible ? { borderColor: theme.lift } : undefined}>
      <button onClick={() => setExpanded((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", display: "block" }}>
        <SectionTitle right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {eligible && (
              <span style={{ fontSize: 12, fontWeight: 700, color: theme.lift, background: tint(theme.lift, 0.16), padding: "2px 7px", borderRadius: 12, fontStyle: "normal", fontFamily: BODY_FONT_STACK }}>
                {t("제안 있음", "Proposal ready")}
              </span>
            )}
            <ChevronDown size={14} color={theme.textFaint} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s ease", flexShrink: 0 }} />
          </div>
        }>
          {title}
        </SectionTitle>
      </button>
      {expanded && (
        eligible ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {badge && <div style={{ fontSize: 12, color: theme.textFaint, marginTop: -4 }}>{badge}</div>}
            {children}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1 }}><PrimaryButton onClick={onAccept}>{acceptLabel}</PrimaryButton></div>
              {onDismiss && (
                <button onClick={onDismiss} style={{ flex: 1, background: "none", border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.textDim, cursor: "pointer", fontSize: 13 }}>
                  {dismissLabel}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: theme.textFaint, lineHeight: 1.6 }}>{ineligibleNote}</div>
        )
      )}
    </Card>
  );
}

function TdeeTab({ settings, onSaveSettings, bodycomp, nutrition, workouts, weekPlan, tdeeHistory, setTdeeHistory, recentAvgSteps }) {
  const { t } = useLang();
  const theme = useTheme();
  const [windowDays, setWindowDays] = useState(14);

  const sorted = [...bodycomp].sort((a, b) => a.date.localeCompare(b.date));
  const currentWeight = sorted[sorted.length - 1]?.weight ?? (settings.startWeight || null);
  const currentBF = sorted[sorted.length - 1]?.bodyfat ?? null;

  const initial = useMemo(() => computeInitialTdee(settings, currentWeight, workouts, recentAvgSteps), [settings, currentWeight, workouts, recentAvgSteps]);
  const calib = useMemo(
    () => (initial ? calibrateTdee(initial.tdee, bodycomp, nutrition, windowDays) : { eligible: false }),
    [initial, bodycomp, nutrition, windowDays]
  );
  const observed = useMemo(() => computeObservedTdee(bodycomp, nutrition, windowDays), [bodycomp, nutrition, windowDays]);
  // Only an explicitly-accepted calibration changes the baseline — see
  // acceptProposal below. Otherwise this is the fresh model estimate.
  const effectiveTdee = settings.acceptedTdee ?? (initial ? initial.tdee : observed?.tdee ?? null);
  const roundedTdee = effectiveTdee ? Math.round(effectiveTdee / 10) * 10 : null;

  const proposal = useMemo(() => {
    if (!roundedTdee) return { eligible: false, note: "" };
    return proposeTdeeCalibration(t, roundedTdee, bodycomp, nutrition, settings.lastAcceptedCalibrationDate);
  }, [roundedTdee, bodycomp, nutrition, settings.lastAcceptedCalibrationDate, t]);

  const acceptProposal = () => {
    if (!proposal.eligible) return;
    onSaveSettings({
      ...settings,
      acceptedTdee: proposal.proposedTdee,
      lastAcceptedCalibrationDate: todayStr(),
      calibrationAcceptedCount: (settings.calibrationAcceptedCount || 0) + 1,
    });
  };
  const resetToModelEstimate = () => {
    onSaveSettings({ ...settings, acceptedTdee: null, lastAcceptedCalibrationDate: null });
  };

  const activityProposal = useMemo(
    () => proposeActivityLevelChange(t, settings, recentAvgSteps, settings.lastActivityProposalDate),
    [settings, recentAvgSteps, t]
  );
  const acceptActivityProposal = () => {
    if (!activityProposal.eligible) return;
    onSaveSettings({ ...settings, acceptedActivityLevel: activityProposal.impliedFactor, lastActivityProposalDate: todayStr() });
  };
  const dismissActivityProposal = () => {
    onSaveSettings({ ...settings, lastActivityProposalDate: todayStr() });
  };

  const [justSaved, setJustSaved] = useState(false);
  const saveSnapshot = () => {
    if (!roundedTdee) return;
    setTdeeHistory([...tdeeHistory, { id: uid(), date: todayStr(), value: roundedTdee }]);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  };

  const chartData = [...tdeeHistory].sort((a, b) => a.date.localeCompare(b.date)).map((h) => ({ date: fmtDate(h.date), maintenance: h.value }));

  const rateTiers = [
    { key: "gentle", frac: 0.005, label: t("완만 (~0.5%/주, 근손실 최소)", "Gentle (~0.5%/wk, min muscle loss)") },
    { key: "standard", frac: 0.007, label: t("표준 (~0.7%/주)", "Standard (~0.7%/wk)") },
    { key: "fast", frac: 0.01, label: t("빠름 (~1%/주)", "Fast (~1%/wk)") },
  ];
  const targets = roundedTdee && currentWeight ? rateTiers.map(({ key, frac, label }) => {
    const target = dailyTargetForRate(roundedTdee, currentWeight, frac, initial?.bmr, settings.sex);
    const macros = macrosFor(target, currentWeight, settings.sex, currentBF);
    return { key, label, target, macros, frac };
  }) : null;

  const ffmKg = currentWeight && currentBF != null ? fatFreeMassKg(currentWeight, currentBF) : null;
  const exercisePerDay = currentWeight ? weeklyNetExerciseKcal(workouts, currentWeight) / 7 : 0;
  const standardTier = targets?.find((tr) => tr.key === "standard");
  const bmi = currentWeight && settings.heightCm ? currentWeight / ((settings.heightCm / 100) ** 2) : null;
  const warnings = (initial && standardTier) ? dietEngineWarnings(t, {
    tdee: roundedTdee, bmr: initial.bmr, targetKcal: standardTier.target, ffmKg,
    exerciseKcalPerDay: exercisePerDay, macros: standardTier.macros, weeklyChangeFraction: standardTier.frac,
    bmi, goalMode: "cut",
  }) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <SectionTitle right={<span style={{ fontSize: 12, color: theme.textFaint }}>{settings.acceptedTdee ? t("승인된 보정 적용 중", "Accepted calibration active") : (initial ? t("DietEngine 기반 (모델)", "DietEngine-based (model)") : t("실측 기반", "Observed-only"))}</span>}>
          {t("유지 칼로리 추정", "Maintenance Calorie Estimate")}
        </SectionTitle>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[7, 14, 28].map((d) => (
            <button key={d} onClick={() => setWindowDays(d)}
              style={{
                flex: 1, padding: 8, borderRadius: 12, fontSize: 12,
                border: `1px solid ${windowDays === d ? theme.lift : theme.border}`,
                background: windowDays === d ? tint(theme.lift, 0.16) : "transparent",
                color: theme.text, cursor: "pointer",
              }}>
              {t(`최근 ${d}일`, `Last ${d}d`)}
            </button>
          ))}
        </div>
        {roundedTdee ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: theme.text, fontFamily: FONT_STACK }}>{roundedTdee}</span>
              <span style={{ fontSize: 12, color: theme.textDim }}>{t("kcal/일 (추정 유지칼로리)", "kcal/day (est. maintenance)")}</span>
            </div>
            {initial ? (
              <>
                <Stat label={t("기초대사량(BMR)", "BMR")} value={`${Math.round(initial.bmr)} kcal`} />
                <Stat label={t("DietEngine 기반 모델값", "DietEngine model estimate")} value={`${Math.round(initial.tdee)} kcal`} />
                {settings.acceptedTdee != null && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Stat label={t("승인된 보정값", "Accepted calibration")} value={`${settings.acceptedTdee} kcal`} />
                    <button onClick={resetToModelEstimate} style={{ background: "none", border: "none", color: theme.textFaint, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                      {t("모델값으로 되돌리기", "Reset to model")}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <Stat label={t("평균 섭취", "Avg Intake")} value={t(`${observed.avgCal} kcal (기록 ${observed.loggedDays}일)`, `${observed.avgCal} kcal (${observed.loggedDays}d logged)`)} />
                <Stat label={t("체중 변화", "Weight Change")} value={`${observed.weightChange > 0 ? "+" : ""}${observed.weightChange.toFixed(1)} kg / ${observed.days.toFixed(0)}${t("일", "d")}`} />
                <div style={{ fontSize: 12, color: theme.textFaint }}>{t("홈에서 나이/키를 설정하면 DietEngine 기반 추정으로 바로 전환돼요.", "Set your age/height on Home to switch to a DietEngine-based estimate immediately.")}</div>
              </>
            )}
            <PrimaryButton onClick={saveSnapshot} style={{ marginTop: 4 }}>
              {justSaved ? <><Check size={15} /> {t("저장됨", "Saved")}</> : t("이 값 기록에 저장", "Save this value")}
            </PrimaryButton>
          </div>
        ) : (
          <EmptyState text={t("데이터가 더 필요해요 — 나이·키를 설정하면 바로 추정돼요.", "Need more data — or set age/height for an instant estimate.")} />
        )}
      </Card>

      {!settings.activityFullAutomation && (
        <ProposalCard
          title={t("활동 수준 제안", "Activity Level Proposal")}
          badge={t("주간 확인", "Weekly check-in")}
          eligible={activityProposal.eligible}
          ineligibleNote={activityProposal.note}
          onAccept={acceptActivityProposal}
          acceptLabel={t("적용", "Apply")}
          onDismiss={dismissActivityProposal}
          dismissLabel={t("나중에", "Not now")}
        >
          <div style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.5 }}>
            {activityProposal.eligible && t(
              `최근 7일 평균 ${activityProposal.avgSteps.toLocaleString()}보 기준으로, 활동 수준을 "${activityProposal.impliedTierLabel}"(으)로 바꿔볼까요?`,
              `Based on a 7-day average of ${activityProposal.avgSteps.toLocaleString()} steps, switch your activity level to "${activityProposal.impliedTierLabel}"?`
            )}
          </div>
        </ProposalCard>
      )}

      <ProposalCard
        title={t("보정 제안 (최근 28일)", "Calibration Proposal (last 28 days)")}
        badge={proposal.eligible ? t(`신뢰도 ${Math.round(proposal.confidence * 100)}%`, `${Math.round(proposal.confidence * 100)}% confidence`) : null}
        eligible={proposal.eligible}
        ineligibleNote={proposal.note || t("보정 제안을 계산할 데이터가 아직 부족해요.", "Not enough data yet to compute a calibration proposal.")}
        onAccept={acceptProposal}
        acceptLabel={t("이 값으로 승인", "Accept this value")}
      >
        {proposal.eligible && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: theme.text, fontFamily: FONT_STACK }}>{proposal.proposedTdee}</span>
              <span style={{ fontSize: 12, color: theme.textDim }}>
                {t("kcal/일 제안", "kcal/day proposed")} ({proposal.changeKcal > 0 ? "+" : ""}{proposal.changeKcal})
              </span>
            </div>
            <Stat label={t("실측 유지칼로리(관찰값)", "Observed TDEE")} value={`${proposal.observedTdee} kcal`} />
            <Stat label={t("반영된 기록", "Data used")} value={t(`식단 ${proposal.completeIntakeDays}일 · 공복 체중 ${proposal.fastedWeightDays}일`, `${proposal.completeIntakeDays}d intake · ${proposal.fastedWeightDays}d fasted weight`)} />
            <div style={{ fontSize: 12, color: theme.textFaint, lineHeight: 1.5 }}>{proposal.note}</div>
          </>
        )}
      </ProposalCard>

      {roundedTdee && currentWeight && (
        <div style={{ fontSize: 12, color: theme.textFaint, textAlign: "center", padding: "4px 0" }}>
          {t("목표 티어·매크로 조정은 Plan 탭에서 할 수 있어요.", "Adjust your tier and macros from the Plan tab.")}
        </div>
      )}

      {warnings.length > 0 && (
        <Card style={{ borderColor: theme.danger }}>
          <SectionTitle>{t("주의사항 (표준 기준)", "Notes (standard tier)")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: theme.danger, lineHeight: 1.5, fontWeight: w.severity === "review" ? 700 : 400 }}>
                {w.severity === "review" ? "⚠ " : "• "}{w.message}
              </div>
            ))}
          </div>
        </Card>
      )}

      {chartData.length >= 2 && (
        <Card>
          <SectionTitle>{t("유지 칼로리 변화 추이", "Maintenance Calorie Trend")}</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ left: -20, right: 10 }}>
              <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke={theme.textFaint} tick={{ fontSize: 10 }} />
              <YAxis stroke={theme.textFaint} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: theme.surfaceRaised, border: `1px solid ${theme.border}`, borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="maintenance" name={t("유지칼로리", "Maintenance")} stroke={theme.ring} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

function ActivityHeatmap({ workouts, nutrition, bodycomp }) {
  const theme = useTheme();
  const { t } = useLang();
  const counts = useMemo(() => {
    const map = {};
    const bump = (date) => { if (date) map[date] = (map[date] || 0) + 1; };
    workouts.forEach((w) => bump(w.date));
    nutrition.forEach((n) => bump(n.date));
    bodycomp.forEach((b) => bump(b.date));
    return map;
  }, [workouts, nutrition, bodycomp]);

  const days = 84;
  const cells = [];
  const end = nowDate();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    cells.push({ date: ds, count: counts[ds] || 0 });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const levelColor = (count) => {
    if (count === 0) return theme.surfaceRaised;
    return mixHex(theme.surfaceRaised, theme.lift, 0.3 + Math.min(1, count / 3) * 0.7);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 3, overflowX: "auto", padding: "2px 0" }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {week.map((c) => (
              <div key={c.date} title={`${c.date}: ${c.count}`} style={{ width: 10, height: 10, borderRadius: 12, background: levelColor(c.count) }} />
            ))}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 6 }}>{t("최근 12주 활동 (운동·식단·체성분)", "Last 12 weeks (workouts, meals, body comp)")}</div>
    </div>
  );
}

function SettingsSectionLabel({ children }) {
  const theme = useTheme();
  return (
    <div style={{
      fontSize: 12.5, fontStyle: "italic", fontWeight: 700, color: theme.textFaint,
      fontFamily: FONT_STACK, letterSpacing: "0.01em",
      borderBottom: `1px solid ${theme.border}`, paddingBottom: 6, marginTop: 4,
    }}>
      {children}
    </div>
  );
}

function ProgressTab({ settings, onSaveSettings, bodycomp, setBodycomp, nutrition, workouts, weekPlan, tdeeHistory, setTdeeHistory, recentAvgSteps }) {
  const { t } = useLang(); const theme = useTheme(); const [section, setSection] = useState("body");
  const items = [{ id: "body", label: t("체성분", "Body") }, { id: "energy", label: t("유지칼로리", "Energy") }];
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <ScreenHeader
      eyebrow={t("분석", "Analytics")}
      title={t("PROGRESS", "PROGRESS")}
      subtitle={t("몸 변화와 에너지 추세를 한 곳에서 확인하세요", "Your body and energy trends in one place")}
      color={theme.progress || theme.run}
    />
    <Card variant="feature" accent={theme.progress || theme.run}>
      <SectionTitle>{t("한눈에 보기", "At a glance")}</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <MiniMetric label={t("체중", "Weight")} value={getLatestBodyComp(bodycomp, settings).weight ? `${Number(getLatestBodyComp(bodycomp, settings).weight).toFixed(1)}kg` : "—"} sub={t("최신 기록", "latest")} color={theme.act || theme.lift} icon={<Scale size={14} />} />
        <MiniMetric label={t("걸음", "Steps")} value={recentAvgSteps ? Math.round(recentAvgSteps).toLocaleString() : "—"} sub={t("최근 평균", "recent avg")} color={theme.progress || theme.run} icon={<Footprints size={14} />} />
        <MiniMetric label={t("운동", "Training")} value={`${workouts.filter(w => w.date >= localDateStr(new Date(Date.now() - 7*86400000))).length}`} sub={t("최근 7일", "last 7 days")} color={theme.eat || theme.lift} icon={<Dumbbell size={14} />} />
        <MiniMetric label={t("식단", "Meals")} value={`${nutrition.filter(n => n.date === todayStr()).length}`} sub={t("오늘 기록", "today")} color={theme.plan || theme.ring} icon={<Utensils size={14} />} />
      </div>
    </Card>
    <div style={{ display: "flex", padding: 4, gap: 4, background: `linear-gradient(135deg, ${tint(theme.progress || theme.run, theme.isDark ? 0.16 : 0.10)}, ${theme.surfaceRaised})`, border: `1px solid ${tint(theme.progress || theme.run, 0.26)}`, borderRadius: 14 }}>{items.map((item) => <button key={item.id} onClick={() => setSection(item.id)} style={{ flex: 1, minHeight: 40, border: "none", borderRadius: 12, cursor: "pointer", color: section === item.id ? (theme.isDark ? "#071827" : theme.text) : theme.textDim, background: section === item.id ? (section === "body" ? (theme.progress || theme.run) : (theme.plan || theme.ring)) : "transparent", fontSize: 13, fontWeight: section === item.id ? 850 : 600, boxShadow: section === item.id ? cardShadow(theme, 0.08) : "none" }}>{item.label}</button>)}</div>
    {section === "body" ? <BodyCompTab bodycomp={bodycomp} setBodycomp={setBodycomp} /> : <TdeeTab settings={settings} onSaveSettings={onSaveSettings} bodycomp={bodycomp} nutrition={nutrition} workouts={workouts} weekPlan={weekPlan} tdeeHistory={tdeeHistory} setTdeeHistory={setTdeeHistory} recentAvgSteps={recentAvgSteps} />}
  </div>;
}

function SettingsTab({ settings, onSaveSettings, workouts, nutrition, bodycomp, programs, onShowIntro }) {
  const { lang, t } = useLang();
  const theme = useTheme();
  const [profileDraft, setProfileDraft] = useState({
    userName: settings.userName || "USERNAME",
    ageYears: settings.ageYears || "",
    heightCm: settings.heightCm || "",
    startWeight: settings.startWeight || "",
    startDate: settings.startDate || todayStr(),
    sex: settings.sex || "male",
    goalMode: settings.goalMode || "cut",
    activityLevel: settings.activityLevel || "low",
  });
  useEffect(() => setProfileDraft({
    userName: settings.userName || "USERNAME",
    ageYears: settings.ageYears || "",
    heightCm: settings.heightCm || "",
    startWeight: settings.startWeight || "",
    startDate: settings.startDate || todayStr(),
    sex: settings.sex || "male",
    goalMode: settings.goalMode || "cut",
    activityLevel: settings.activityLevel || "low",
  }), [settings.userName, settings.ageYears, settings.heightCm, settings.startWeight, settings.startDate, settings.sex, settings.goalMode, settings.activityLevel]);

  const saveProfile = () => onSaveSettings({
    ...settings,
    userName: String(profileDraft.userName || "USERNAME").trim() || "USERNAME",
    ageYears: Number(profileDraft.ageYears) || 0,
    heightCm: Number(profileDraft.heightCm) || 0,
    startWeight: Number(profileDraft.startWeight) || 0,
    startDate: profileDraft.startDate || todayStr(),
    sex: profileDraft.sex || "male",
    goalMode: profileDraft.goalMode || "cut",
    activityLevel: profileDraft.activityLevel || "low",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ paddingBottom: 12, borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: theme.text }}>{t("설정", "Settings")}</div>
        <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>{t("앱 동작과 개인 환경을 관리합니다.", "Manage app behaviour and your personal setup.")}</div>
      </div>
      <SettingsSectionLabel>{t("일반", "General")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>{t("기본 프로필", "Profile Basics")}</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label={t("이름", "Name")}><TextInput value={profileDraft.userName} onChange={(e) => setProfileDraft({ ...profileDraft, userName: e.target.value })} /></Field>
          <Field label={t("나이", "Age")}><UnitInput type="number" inputMode="numeric" unit={t("세", "yr")} value={profileDraft.ageYears} onChange={(e) => setProfileDraft({ ...profileDraft, ageYears: e.target.value })} placeholder="23" /></Field>
          <Field label={t("키(cm)", "Height (cm)")}><UnitInput type="number" unit="cm" value={profileDraft.heightCm} onChange={(e) => setProfileDraft({ ...profileDraft, heightCm: e.target.value })} placeholder="175" /></Field>
          <Field label={t("시작 체중(kg)", "Starting weight (kg)")}><UnitInput type="number" step="0.1" unit="kg" value={profileDraft.startWeight} onChange={(e) => setProfileDraft({ ...profileDraft, startWeight: e.target.value })} placeholder="80" /></Field>
          <Field label={t("시작 날짜", "Start date")}><TextInput type="date" value={profileDraft.startDate} onChange={(e) => setProfileDraft({ ...profileDraft, startDate: e.target.value })} /></Field>
          <Field label={t("성별", "Sex")}><Select value={profileDraft.sex} onChange={(e) => setProfileDraft({ ...profileDraft, sex: e.target.value })}><option value="male">{t("남성", "Male")}</option><option value="female">{t("여성", "Female")}</option></Select></Field>
          <Field label={t("목표", "Goal")}><Select value={profileDraft.goalMode} onChange={(e) => setProfileDraft({ ...profileDraft, goalMode: e.target.value })}><option value="cut">{t("감량", "Cut")}</option><option value="maintain">{t("유지", "Maintain")}</option><option value="gain">{t("증량", "Gain")}</option></Select></Field>
          <Field label={t("활동수준", "Activity Level")}><Select value={profileDraft.activityLevel} onChange={(e) => setProfileDraft({ ...profileDraft, activityLevel: e.target.value })}><option value="low">{t("낮음", "Low")}</option><option value="medium">{t("보통", "Medium")}</option><option value="high">{t("높음", "High")}</option></Select></Field>
        </div>
        <PrimaryButton onClick={saveProfile} style={{ marginTop: 12 }}>{t("프로필 저장", "Save Profile")}</PrimaryButton>
        <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 8, lineHeight: 1.45 }}>
          {t("온보딩 때 입력한 기본값을 나중에도 여기서 수정할 수 있어요.", "You can edit the basics from onboarding here later.")}
        </div>
      </Card>

      <Card>
        <SectionTitle>{t("언어", "Language")}</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onSaveSettings({ ...settings, language: "ko" })}
            style={{
              flex: 1, padding: 10, borderRadius: 12, fontSize: 13, cursor: "pointer",
              border: `1px solid ${lang === "ko" ? theme.lift : theme.border}`,
              background: lang === "ko" ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
            }}>
            한국어
          </button>
          <button onClick={() => onSaveSettings({ ...settings, language: "en" })}
            style={{
              flex: 1, padding: 10, borderRadius: 12, fontSize: 13, cursor: "pointer",
              border: `1px solid ${lang === "en" ? theme.lift : theme.border}`,
              background: lang === "en" ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
            }}>
            English
          </button>
        </div>
      </Card>

      <Card>
        <SectionTitle>{t("테마", "Theme")}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(PALETTES).map(([id, p]) => {
            const active = (settings.colorPalette || DEFAULT_PALETTE) === id;
            return (
              <button key={id} onClick={() => onSaveSettings({ ...settings, colorPalette: id })}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, cursor: "pointer",
                  border: `1px solid ${active ? theme.lift : theme.border}`,
                  background: active ? tint(theme.lift, 0.1) : "transparent",
                }}>
                <span style={{
                  width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                  background: `linear-gradient(135deg, ${p.lift}, ${p.run})`,
                  border: `1px solid ${theme.border}`,
                }} />
                <span style={{ fontSize: 13, color: theme.text, fontWeight: active ? 700 : 500 }}>{p.name}</span>
                {active && <Check size={14} color={theme.lift} style={{ marginLeft: "auto" }} />}
              </button>
            );
          })}
        </div>
      </Card>

      <SettingsSectionLabel>{t("자동화", "Automation")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>{t("활동 수준 자동 반영", "Activity Level Automation")}</SectionTitle>
        <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 12, lineHeight: 1.5 }}>
          {t(
            "끄면(기본값) 걸음수 기반 변경 제안을 주 1회 확인하고 직접 승인해야 반영돼요. 켜면 검토 없이 걸음수가 바로 활동 계수에 반영돼요.",
            "Off (default): weekly step-based suggestions require your explicit approval. On: steps apply to the activity factor immediately, no review."
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: theme.text }}>{t("전체 자동화", "Full automation")}</span>
          <button
            onClick={() => onSaveSettings({ ...settings, activityFullAutomation: !settings.activityFullAutomation })}
            style={{
              width: 44, height: 26, borderRadius: 12, border: "none", cursor: "pointer", position: "relative",
              background: settings.activityFullAutomation ? theme.lift : theme.surfaceRaised,
              transition: "background 0.2s ease",
            }}>
            <div style={{
              position: "absolute", top: 3, left: settings.activityFullAutomation ? 21 : 3,
              width: 20, height: 20, borderRadius: "50%", background: "#FBFAF2",
              transition: "left 0.2s ease",
            }} />
          </button>
        </div>
      </Card>

      <SettingsSectionLabel>{t("알림 & 피드백", "Notifications & Feedback")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>{t("촉각 피드백", "Haptic Feedback")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: theme.text }}>{t("탭할 때 살짝 진동", "Vibrate lightly on tap")}</span>
          <button
            onClick={() => {
              const next = !settings.hapticsEnabled;
              setHapticsEnabled(next);
              onSaveSettings({ ...settings, hapticsEnabled: next });
            }}
            style={{
              width: 44, height: 26, borderRadius: 12, border: "none", cursor: "pointer", position: "relative",
              background: settings.hapticsEnabled ? theme.lift : theme.surfaceRaised,
              transition: "background 0.2s ease",
            }}>
            <div style={{
              position: "absolute", top: 3, left: settings.hapticsEnabled ? 21 : 3,
              width: 20, height: 20, borderRadius: "50%", background: "#FBFAF2",
              transition: "left 0.2s ease",
            }} />
          </button>
        </div>
      </Card>

      <Card>
        <SectionTitle>{t("매일 알림", "Daily Reminder")}</SectionTitle>
        <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 12, lineHeight: 1.5 }}>
          {t("설정한 시간에 데일리 로그를 남겼는지 알려줘요.", "Reminds you to log your Day Log at the time you pick.")}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: settings.dailyReminderEnabled ? 10 : 0 }}>
          <span style={{ fontSize: 13, color: theme.text }}>{t("알림 켜기", "Enable reminder")}</span>
          <button
            onClick={async () => {
              const next = !settings.dailyReminderEnabled;
              if (next) {
                const ok = await scheduleDailyReminder(
                  settings.dailyReminderHour ?? 20,
                  settings.dailyReminderMinute ?? 0,
                  t("데일리 로그를 남겨보세요", "Log your Day Log"),
                  t("오늘 기분·에너지·수면을 기록해보세요.", "Jot down today's mood, energy, and sleep.")
                );
                if (!ok) {
                  window.alert(t("알림 권한이 필요해요. 안드로이드 앱에서 설정해주세요.", "Notification permission is needed — try this from the installed Android app."));
                  return;
                }
              } else {
                await cancelDailyReminder();
              }
              onSaveSettings({ ...settings, dailyReminderEnabled: next });
            }}
            style={{
              width: 44, height: 26, borderRadius: 12, border: "none", cursor: "pointer", position: "relative",
              background: settings.dailyReminderEnabled ? theme.lift : theme.surfaceRaised,
              transition: "background 0.2s ease",
            }}>
            <div style={{
              position: "absolute", top: 3, left: settings.dailyReminderEnabled ? 21 : 3,
              width: 20, height: 20, borderRadius: "50%", background: "#FBFAF2",
              transition: "left 0.2s ease",
            }} />
          </button>
        </div>
        {settings.dailyReminderEnabled && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: theme.text }}>{t("알림 시간", "Reminder time")}</span>
            <input
              type="time"
              value={`${String(settings.dailyReminderHour ?? 20).padStart(2, "0")}:${String(settings.dailyReminderMinute ?? 0).padStart(2, "0")}`}
              onChange={async (e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                onSaveSettings({ ...settings, dailyReminderHour: h, dailyReminderMinute: m });
                await scheduleDailyReminder(h, m, t("데일리 로그를 남겨보세요", "Log your Day Log"), t("오늘 기분·에너지·수면을 기록해보세요.", "Jot down today's mood, energy, and sleep."));
              }}
              style={{ ...getInputStyle(theme), width: "auto", padding: "8px 10px" }}
            />
          </div>
        )}
      </Card>

      <SettingsSectionLabel>{t("데이터", "Data")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>Footprint</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          <Stat label={t("운동 기록 수", "Workout entries")} value={`${workouts.length}`} />
          <Stat label={t("식단 기록 수", "Nutrition entries")} value={`${nutrition.length}`} />
          <Stat label={t("체성분 기록 수", "Body comp entries")} value={`${bodycomp.length}`} />
          <Stat label={t("운동 프로그램 수", "Programs")} value={`${programs.length}`} />
        </div>
        <ActivityHeatmap workouts={workouts} nutrition={nutrition} bodycomp={bodycomp} />
        <button
          onClick={async () => {
            const ok = window.confirm(t(
              "정말 모든 데이터를 초기화할까요? 운동/식단/체성분 기록과 설정이 전부 삭제되고 되돌릴 수 없습니다.",
              "Reset all data? Workouts, meals, body comp logs, and settings will all be deleted permanently."
            ));
            if (!ok) return;
            await resetAllData();
            setDevDateOffsetDays(0);
            window.location.reload();
          }}
          style={{ background: "none", border: "none", color: theme.danger, fontSize: 12, cursor: "pointer", padding: "10px 0 0", textAlign: "left" }}
        >
          {t("전체 데이터 초기화", "Reset all data")}
        </button>
      </Card>

      <Card>
        <SectionTitle right={<span style={{ fontSize: 12, color: theme.textFaint }}>{t("테스트 전용", "Testing only")}</span>}>
          {t("날짜 시뮬레이션", "Date Simulation")}
        </SectionTitle>
        <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 10, lineHeight: 1.5 }}>
          {t("기기 날짜는 그대로 두고 앱의 '오늘'만 앞당겨요. 적용하면 새로고침됩니다.", "Fast-forwards the app's 'today' without touching your device clock. Applying this reloads the app.")}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: theme.textDim }}>{t("현재 시뮬레이션 날짜", "Current simulated date")}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: theme.text, fontVariantNumeric: "tabular-nums" }}>
            {todayStr()}{getDevDateOffsetDays() !== 0 ? ` (${getDevDateOffsetDays() > 0 ? "+" : ""}${getDevDateOffsetDays()}${t("일", "d")})` : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { label: "-1", delta: -1 },
            { label: "+1", delta: 1 },
            { label: "+7", delta: 7 },
            { label: "+14", delta: 14 },
          ].map(({ label, delta }) => (
            <button key={label} onClick={async () => {
                const newOffset = getDevDateOffsetDays() + delta;
                setDevDateOffsetDays(newOffset);
                await saveKey("settings", { ...settings, devDateOffsetDays: newOffset });
                window.location.reload();
              }}
              style={{ flex: 1, padding: 8, borderRadius: 12, fontSize: 12.5, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, cursor: "pointer" }}>
              {label}{t("일", "d")}
            </button>
          ))}
        </div>
        {getDevDateOffsetDays() !== 0 && (
          <button onClick={async () => {
              setDevDateOffsetDays(0);
              await saveKey("settings", { ...settings, devDateOffsetDays: 0 });
              window.location.reload();
            }}
            style={{ background: "none", border: "none", color: theme.danger, fontSize: 12, cursor: "pointer", padding: "10px 0 0", textAlign: "left" }}>
            {t("실제 날짜로 복원", "Reset to real date")}
          </button>
        )}
      </Card>

      <Card>
        <SectionTitle>{t("앱 소개", "App Intro")}</SectionTitle>
        <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 10, lineHeight: 1.5 }}>
          {t("처음 설치할 때 봤던 기능 소개를 다시 볼 수 있어요.", "Watch the feature walkthrough you saw on first install again.")}
        </div>
        <button onClick={onShowIntro}
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 12, border: `1px solid ${theme.border}`,
            background: "none", color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
          {t("설명 다시 보기", "View intro again")}
        </button>
      </Card>

      <Card>
        <SectionTitle>{t("정보", "About")}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, color: theme.textDim }}>
            {t("개발자", "Developer")}: <span style={{ color: theme.text, fontWeight: 600 }}>Jinwoo B</span>
          </div>
          <div style={{ fontSize: 13, color: theme.textDim }}>
            {t("문의", "Contact")}:{" "}
            <a href="mailto:zeennnu@gmail.com" style={{ color: theme.lift, fontWeight: 600, textDecoration: "none" }}>
              zeennnu@gmail.com
            </a>
          </div>
          <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 6, lineHeight: 1.6, borderTop: `1px solid ${theme.border}`, paddingTop: 8 }}>
            {t(
              "© 2026 Jinwoo B. All rights reserved. 이 앱(HYBRID LOG)의 디자인, 코드 및 콘텐츠에 대한 저작권은 개발자 Jinwoo B에게 있으며, 무단 복제·배포·수정 및 상업적 이용을 금합니다.",
              "© 2026 Jinwoo B. All rights reserved. The design, code, and content of this app (HYBRID LOG) are copyrighted by developer Jinwoo B. Unauthorized copying, distribution, modification, or commercial use is prohibited."
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Onboarding({ onDone, settings, onSaveSettings, isFirstTime }) {
  const { t } = useLang();
  const theme = useTheme();
  const [step, setStep] = useState(0);
  const [showQuickSetup, setShowQuickSetup] = useState(false);
  const [qsAge, setQsAge] = useState("");
  const [qsHeight, setQsHeight] = useState("");
  const [qsWeight, setQsWeight] = useState("");
  const [qsGoal, setQsGoal] = useState("cut");
  const [qsActivity, setQsActivity] = useState("low");
  const [qsPregnant, setQsPregnant] = useState(false);
  const [qsEdRecovery, setQsEdRecovery] = useState(false);
  const slides = [
    { icon: TrendingUp, title: t("HYBRID LOG에 오신 걸 환영해요", "Welcome to HYBRID LOG"), body: t("이 앱은 메뉴를 뒤지는 대신 Today, Act, Eat, Plan, Progress 흐름으로 오늘 할 일을 바로 기록하게 도와줘요.", "An intent-first tracker: Today, Act, Eat, Plan, and Progress — built so you can log what you did without hunting through menus.") },
    { icon: Activity, title: t("Today — 오늘 상태와 진입점", "Today — your starting point"), body: t("Body, Steps, Goal을 짧게 보고 Act, Eat, Plan으로 바로 들어갑니다. 상단 3개 지표도 탭해서 관련 화면으로 이동할 수 있어요.", "See Body, Steps, and Goal at a glance, then jump straight into Act, Eat, or Plan. The top status tiles are interactive too.") },
    { icon: Dumbbell, title: t("Act — 한 일 기록", "Act — log what you did"), body: t("근력 운동, 러닝, 체성분 업데이트, 체크인을 한 곳에서 처리합니다. 가이드 운동은 이어하기를 지원하고, 러닝은 시작/종료 후 필요한 정보만 추가합니다.", "Log training, cardio, body updates, and check-ins in one place. Guided sessions can resume, and runs ask for details only after you stop.") },
    { icon: Utensils, title: t("Eat — 먹은 것 기록", "Eat — log what you ate"), body: t("음식 검색, 최근 음식, 직접 입력으로 식사와 매크로를 빠르게 기록합니다. DietEngine 목표 칼로리 계산식은 그대로 유지됩니다.", "Log meals and macros quickly with search, recent foods, or manual entry. DietEngine calorie logic stays intact.") },
    { icon: Clock, title: t("Plan — 목표와 계획", "Plan — goals and planning"), body: t("감량/유지/증량, 칼로리 전략, 탄수화물 비율, 주간 운동 계획을 실제로 편집합니다. 일반 설정은 우상단 아이콘에서 관리해요.", "Edit goals, calorie strategy, carb ratio, and weekly training plans here. General settings live behind the top-right icon.") },
    { icon: BarChart3, title: t("Progress — 결과 해석", "Progress — understand the result"), body: t("체성분, 운동량, 식단, 유지칼로리 흐름을 확인하고, 보정 제안은 직접 승인할 때만 반영됩니다.", "Review body, training, nutrition, and maintenance trends. Calibration suggestions apply only when you approve them.") },
  ];
  const s = slides[step];
  const Icon = s.icon;

  const finishQuickSetup = () => {
    const updates = {
      hasOnboarded: true, goalMode: qsGoal, activityLevel: qsActivity,
      pregnantOrBreastfeeding: qsPregnant, edRecoveryOrClinical: qsEdRecovery,
    };
    if (qsAge) updates.ageYears = Number(qsAge);
    if (qsHeight) updates.heightCm = Number(qsHeight);
    if (qsWeight) updates.startWeight = Number(qsWeight);
    onSaveSettings({ ...settings, ...updates });
    onDone();
  };
  const skipQuickSetup = () => {
    onSaveSettings({ ...settings, hasOnboarded: true });
    onDone();
  };
  const advanceOrSetup = () => {
    if (isFirstTime) setShowQuickSetup(true);
    else { onSaveSettings({ ...settings, hasOnboarded: true }); onDone(); }
  };

  if (showQuickSetup) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: tint(theme.text, 0.5), zIndex: 200,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}>
        <div style={{
          background: theme.surface, borderRadius: "22px 22px 0 0", padding: 24,
          width: "100%", maxWidth: 480, boxSizing: "border-box",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: theme.text, fontFamily: FONT_STACK }}>{t("빠른 설정", "Quick Setup")}</div>
            <div style={{ fontSize: 12.5, color: theme.textDim, marginTop: 4 }}>{t("몇 가지만 입력하면 바로 목표 칼로리를 계산해드려요. 나중에 언제든 바꿀 수 있어요.", "A few quick fields and we'll calculate your calorie target right away. You can change these anytime.") }</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("나이", "Age")}><TextInput type="number" value={qsAge} onChange={(e) => setQsAge(e.target.value)} placeholder="28" /></Field>
            <Field label={t("키(cm)", "Height (cm)")}><TextInput type="number" value={qsHeight} onChange={(e) => setQsHeight(e.target.value)} placeholder="178" /></Field>
          </div>
          <Field label={t("현재 체중(kg)", "Current Weight (kg)")}><TextInput type="number" step="0.1" value={qsWeight} onChange={(e) => setQsWeight(e.target.value)} placeholder="91.4" /></Field>
          <div>
            <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 6 }}>{t("목표", "Goal")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["cut", t("다이어트", "Cut")], ["maintain", t("유지어트", "Maintain")], ["gain", t("증량", "Gain")]].map(([id, label]) => (
                <button key={id} onClick={() => setQsGoal(id)}
                  style={{
                    flex: 1, padding: 9, borderRadius: 12, fontSize: 12.5, cursor: "pointer",
                    border: `1px solid ${qsGoal === id ? theme.lift : theme.border}`,
                    background: qsGoal === id ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 6 }}>{t("평소 활동 수준", "Usual Activity Level")}</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[
                ["very_low", t("매우 적음", "Very low")], ["low", t("적음", "Low")], ["moderate", t("보통", "Moderate")],
                ["high", t("많음", "High")], ["very_high", t("매우 많음", "Very high")],
              ].map(([id, label]) => (
                <button key={id} onClick={() => setQsActivity(id)}
                  style={{
                    flex: 1, padding: "8px 2px", borderRadius: 12, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${qsActivity === id ? theme.lift : theme.border}`,
                    background: qsActivity === id ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4, borderTop: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 12, color: theme.textFaint, lineHeight: 1.4 }}>
              {t("해당되는 항목이 있으면 표시해주세요 — 다이어트 자동 목표 계산이 꺼지고 유지 칼로리만 보여드려요.", "Check any that apply — this turns off automated cut targets and shows maintenance calories only.")}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: theme.text, cursor: "pointer" }}>
              <input type="checkbox" checked={qsPregnant} onChange={(e) => setQsPregnant(e.target.checked)} />
              {t("임신 또는 수유 중이에요", "I'm pregnant or breastfeeding")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: theme.text, cursor: "pointer" }}>
              <input type="checkbox" checked={qsEdRecovery} onChange={(e) => setQsEdRecovery(e.target.checked)} />
              {t("식이장애 회복 중이거나 관련 임상 제한이 있어요", "I'm in eating-disorder recovery or have a related clinical restriction")}
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={skipQuickSetup} style={{ flex: 1, background: "none", border: "none", color: theme.textFaint, fontSize: 13, padding: 11, cursor: "pointer" }}>
              {t("나중에 설정", "Set up later")}
            </button>
            <div style={{ flex: 2 }}><PrimaryButton onClick={finishQuickSetup}>{t("완료", "Done")}</PrimaryButton></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: tint(theme.text, 0.5), zIndex: 200,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        background: theme.surface, borderRadius: "22px 22px 0 0", padding: 24,
        width: "100%", maxWidth: 480, boxSizing: "border-box",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center",
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%", background: tint(theme.lift, 0.16),
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4,
        }}>
          <Icon size={26} color={theme.lift} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: theme.text, fontFamily: FONT_STACK }}>{s.title}</div>
        <div style={{ fontSize: 13, color: theme.textDim, lineHeight: 1.5 }}>{s.body}</div>
        <div style={{ display: "flex", gap: 6, margin: "6px 0 4px" }}>
          {slides.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 12,
              background: i === step ? theme.lift : theme.border, transition: "width 0.2s ease",
            }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 8 }}>
          {step < slides.length - 1 ? (
            <>
              <button onClick={skipQuickSetup} style={{ flex: 1, background: "none", border: "none", color: theme.textFaint, fontSize: 13, padding: 11, cursor: "pointer" }}>
                {t("건너뛰기", "Skip")}
              </button>
              <div style={{ flex: 2 }}><PrimaryButton onClick={() => setStep((v) => v + 1)}>{t("다음", "Next")}</PrimaryButton></div>
            </>
          ) : (
            <div style={{ flex: 1 }}><PrimaryButton onClick={advanceOrSetup}>{t("시작하기", "Get Started")}</PrimaryButton></div>
          )}
        </div>
      </div>
    </div>
  );
}

// Shown for a few seconds after a delete, giving a chance to undo before
// it's gone for good — small icon-only delete buttons in scrollable lists
// are easy to tap by accident, so a single irreversible tap felt risky.
function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel, cancelLabel, tone = "danger", hideCancel = false }) {
  const theme = useTheme();
  const { t } = useLang();
  const dialog = (
    <div
      role="presentation"
      style={{
        position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.48)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))",
        boxSizing: "border-box",
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={t("확인", "Confirmation")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.darkPanel || theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20,
          maxWidth: 360, width: "100%", boxSizing: "border-box",
          boxShadow: "0 18px 44px rgba(0,0,0,0.36)", fontFamily: BODY_FONT_STACK,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 18, lineHeight: 1.5, whiteSpace: "pre-line" }}>{message}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {!hideCancel && (
            <button data-confirm-cancel="true" onClick={onCancel} style={{
              flex: 1, minHeight: 46, padding: 11, borderRadius: 12, border: `1px solid ${theme.border}`,
              background: "transparent", color: theme.textDim, cursor: "pointer", fontSize: 13, fontWeight: 700,
            }}>
              {cancelLabel || t("취소", "Cancel")}
            </button>
          )}
          <button onClick={onConfirm} style={{
            flex: 1, minHeight: 46, padding: 11, borderRadius: 12, border: "none",
            background: tone === "danger" ? theme.danger : theme.lift, color: "#FBFAF2", cursor: "pointer", fontSize: 13, fontWeight: 800,
          }}>
            {confirmLabel || t("삭제", "Delete")}
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}

function EmptyState({ text, icon: Icon, actionLabel, onAction }) {
  const theme = useTheme();
  return (
    <div style={{ textAlign: "center", padding: "28px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {Icon && (
        <div style={{
          width: 42, height: 42, borderRadius: 12, border: `1px solid ${theme.border}`, background: "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={20} color={theme.textFaint} />
        </div>
      )}
      <div style={{ color: theme.textDim, fontSize: 14, lineHeight: 1.55, maxWidth: 280 }}>{text}</div>
      {actionLabel && onAction && (
        <button onClick={onAction} style={{
          background: "none", border: `1px solid ${theme.lift}`, color: theme.lift,
          borderRadius: 12, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 2,
        }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   APP ROOT
--------------------------------------------------------- */
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [showIntroAgain, setShowIntroAgain] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [tab, setTab] = useState("today");
  const [actInitialView, setActInitialView] = useState(null);
  const [actResetSignal, setActResetSignal] = useState(0);
  const [eatResetSignal, setEatResetSignal] = useState(0);
  const [planResetSignal, setPlanResetSignal] = useState(0);
  const [actCurrentView, setActCurrentView] = useState("overview");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [bodycomp, setBodycompState] = useState([]);
  const [workouts, setWorkoutsState] = useState([]);
  const [nutrition, setNutritionState] = useState([]);
  const [tdeeHistory, setTdeeHistoryState] = useState([]);
  const [customFoods, setCustomFoodsState] = useState([]);
  const [programs, setProgramsState] = useState(DEFAULT_PROGRAMS);
  const [weekPlan, setWeekPlanState] = useState(DEFAULT_WEEK_PLAN);
  const [dayLogs, setDayLogsState] = useState([]);
  const [err, setErr] = useState(null);
  const [viewportHeight, setViewportHeight] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.visualViewport?.height || window.innerHeight || null;
  });

  useEffect(() => {
    const updateViewportHeight = () => {
      const h = window.visualViewport?.height || window.innerHeight || null;
      if (h) {
        setViewportHeight(h);
        document.documentElement.style.setProperty("--app-viewport-height", `${h}px`);
      }
    };
    updateViewportHeight();
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);

    const onFocusIn = (event) => {
      const target = event.target;
      if (!target || !target.matches?.("input, textarea, select")) return;
      setTimeout(() => {
        try {
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        } catch (e) {
          target.scrollIntoView();
        }
      }, 160);
    };
    document.addEventListener("focusin", onFocusIn);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  useEffect(() => {
    (async () => {
      await runStorageMigrations();
      const [s, b, w, n, t, cf, pr, wp, dl] = await Promise.all([
        loadKey("settings", DEFAULT_SETTINGS),
        loadKey("bodycomp", []),
        loadKey("workouts", []),
        loadKey("nutrition", []),
        loadKey("tdeeHistory", []),
        loadKey("customFoods", []),
        loadKey("programs", DEFAULT_PROGRAMS),
        loadKey("weekPlan", DEFAULT_WEEK_PLAN),
        loadKey("dayLogs", []),
      ]);
      const migratedSettings = migrateSettings(s);
      setSettings(migratedSettings); setBodycompState((b || []).map(migrateBodyEntry)); setWorkoutsState((w || []).map(migrateWorkoutEntry)); setNutritionState((n || []).map(migrateNutritionEntry)); setTdeeHistoryState(t); setCustomFoodsState(cf); setProgramsState(pr); setWeekPlanState(wp); setDayLogsState(dl);
      setDevDateOffsetDays(s.devDateOffsetDays || 0);
      setHapticsEnabled(s.hapticsEnabled !== false);
      setLoaded(true);
    })();
  }, []);

  const setBodycomp = useCallback((v) => { setBodycompState(v); saveKey("bodycomp", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const setWorkouts = useCallback((v) => { setWorkoutsState(v); saveKey("workouts", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const setNutrition = useCallback((v) => { setNutritionState(v); saveKey("nutrition", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const setTdeeHistory = useCallback((v) => { setTdeeHistoryState(v); saveKey("tdeeHistory", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const setCustomFoods = useCallback((v) => { setCustomFoodsState(v); saveKey("customFoods", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const setPrograms = useCallback((v) => { setProgramsState(v); saveKey("programs", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const setWeekPlan = useCallback((v) => { setWeekPlanState(v); saveKey("weekPlan", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const setDayLogs = useCallback((v) => { setDayLogsState(v); saveKey("dayLogs", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);
  const saveSettings = useCallback((v) => { setSettings(v); saveKey("settings", v).then((ok) => !ok && setErr("저장 실패 / Save failed")); }, []);

  useEffect(() => {
    if (!document.getElementById("hybrid-log-font")) {
      const preconnect1 = document.createElement("link");
      preconnect1.rel = "preconnect";
      preconnect1.href = "https://fonts.googleapis.com";
      const preconnect2 = document.createElement("link");
      preconnect2.rel = "preconnect";
      preconnect2.href = "https://fonts.gstatic.com";
      preconnect2.crossOrigin = "anonymous";
      const link = document.createElement("link");
      link.id = "hybrid-log-font";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap";
      document.head.appendChild(preconnect1);
      document.head.appendChild(preconnect2);
      document.head.appendChild(link);
    }
    if (!document.getElementById("hybrid-log-tap-style")) {
      const style = document.createElement("style");
      style.id = "hybrid-log-tap-style";
      style.textContent = `
        * { -webkit-tap-highlight-color: transparent; }
        button, a, input, textarea, select { -webkit-tap-highlight-color: transparent; outline: none; font-weight: 500; }
        button { touch-action: manipulation; }
        html, body { height: 100%; margin: 0; overflow: hidden; }
        #root { height: 100%; }
        * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
        *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
        input, textarea, select { font-family: ${BODY_FONT_STACK}; }
        button { font-family: ${BODY_FONT_STACK}; }
        @keyframes hlTabBounce { 0% { transform: scale(1); } 35% { transform: scale(1.28); } 60% { transform: scale(0.92); } 100% { transform: scale(1); } }
        @keyframes hlSkeletonPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Single source of haptic feedback for every interactive tap in the app
  // (buttons), rather than wiring it into individual components — this way
  // the on/off setting reliably covers everything, and nothing gets missed.
  useEffect(() => {
    const onPointerDown = (e) => {
      const btn = e.target.closest && e.target.closest("button");
      if (btn && !btn.disabled) haptic();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const safeSettings = settings && typeof settings === "object" ? settings : DEFAULT_SETTINGS;
  const lang = safeSettings.language || "ko";
  const t = (ko, en) => (lang === "en" ? en : ko);
  const theme = PALETTES[safeSettings.colorPalette] || PALETTES[DEFAULT_PALETTE];

  useEffect(() => {
    (async () => {
      try {
        await StatusBar.setBackgroundColor({ color: theme.bg });
        await StatusBar.setStyle({ style: theme.isDark ? Style.Dark : Style.Light });
        await StatusBar.setOverlaysWebView({ overlay: false });
      } catch (e) {
        // ignore — not running on a native platform
      }
    })();
    const metaTag = document.querySelector('meta[name="theme-color"]');
    if (metaTag) metaTag.setAttribute("content", theme.bg);
  }, [theme.bg, theme.isDark]);

  // A trailing ~7-day average of *completed* past days (today excluded),
  // used for the TDEE activity-factor calculation. A single day's activity
  // — especially one that isn't even over yet — shouldn't swing today's
  // calorie target; the multiplier is meant to reflect a habitual pattern,
  // smoothed over about a week. Recomputed once per load and once daily
  // via getTodaySteps's own rollover (calling it triggers the archive).
  const [recentAvgSteps, setRecentAvgSteps] = useState(null);
  const [currentSteps, setCurrentSteps] = useState(null);
  const stepTrackingEnabled = isAndroidStepRuntime();
  useEffect(() => {
    if (!loaded) return;
    if (!stepTrackingEnabled) {
      setRecentAvgSteps(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        await getTodaySteps(); // ensures yesterday gets archived into history if the day just rolled over
        const avg = await getRecentAvgSteps();
        if (mounted) setRecentAvgSteps(avg);
      } catch (e) {
        // ignore — not running on a native Android platform
      }
    })();
    return () => { mounted = false; };
  }, [loaded, stepTrackingEnabled]);

  useEffect(() => {
    if (!loaded) return;
    if (!stepTrackingEnabled) {
      setCurrentSteps(null);
      return;
    }
    let mounted = true;
    let interval;
    const refresh = async () => {
      const result = await getTodaySteps();
      if (mounted && result && result.steps != null) setCurrentSteps(result.steps);
    };
    refresh();
    interval = setInterval(refresh, 10000);
    return () => { mounted = false; if (interval) clearInterval(interval); };
  }, [loaded, stepTrackingEnabled]);

  const tabs = [
    { id: "today", label: t("Today", "Today"), icon: TrendingUp, color: theme.act || theme.ring },
    { id: "act", label: t("Act", "Act"), icon: Activity, color: theme.act || theme.lift },
    { id: "eat", label: t("Eat", "Eat"), icon: Utensils, color: theme.eat || theme.lift },
    { id: "plan", label: t("Plan", "Plan"), icon: Clock, color: theme.plan || theme.ring },
    { id: "progress", label: t("Progress", "Progress"), icon: BarChart3, color: theme.progress || theme.run },
  ];
  const tabIndex = tabs.findIndex((tb) => tb.id === tab);

  // Instagram-style carousel: all tabs sit side by side in one strip; the
  // strip's transform follows the finger 1:1 while dragging (no transition),
  // then either finishes the swipe or springs back with a short transition.
  const trackWrapRef = useRef(null);
  const slideRefs = useRef({});
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [trackWidth, setTrackWidth] = useState(360);
  useEffect(() => {
    const el = trackWrapRef.current;
    if (!el) return;
    // measure immediately (covers the first paint after `loaded` flips true)
    if (el.offsetWidth > 0) setTrackWidth(el.offsetWidth);
    // and keep re-measuring on any future resize/orientation change/keyboard open etc.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w > 0) setTrackWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  const dragStartRef = useRef(null);
  const draggingRef = useRef(false);
  const [dragPx, setDragPx] = useState(0);
  const [live, setLive] = useState(false);

  const goToTab = (newId, options = {}) => {
    const { reset = false } = options;
    blurActiveInput();
    setDragPx(0);
    setLive(false);
    if (reset) {
      if (newId === "act") {
        setActInitialView(null);
        setActCurrentView("overview");
        setActResetSignal((v) => v + 1);
      }
      if (newId === "eat") setEatResetSignal((v) => v + 1);
      if (newId === "plan") setPlanResetSignal((v) => v + 1);
    }
    setTab(newId);
    requestAnimationFrame(() => {
      const el = slideRefs.current[newId];
      if (el) el.scrollTo({ top: 0, behavior: "auto" });
    });
  };
  const openActView = (viewId) => {
    blurActiveInput();
    setActInitialView(viewId);
    setDragPx(0);
    setLive(false);
    setTab("act");
  };

  // Whichever tab becomes active, reflect *its* scroll position (each tab
  // keeps its own independent scroll, so the button shouldn't stay stuck
  // from whatever the previous tab's position was).
  useEffect(() => {
    const el = slideRefs.current[tab];
    setShowScrollTop(!!el && el.scrollTop > 150);
  }, [tab]);

  const scrollActiveTabToTop = () => {
    const el = slideRefs.current[tab];
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
  };

  const returnToToday = useCallback(() => {
    setShowSettingsSheet(false);
    setShowIntroAgain(false);
    setActInitialView(null);
    setActCurrentView("overview");
    setActResetSignal((v) => v + 1);
    setDragPx(0);
    setLive(false);
    setTab("today");
    requestAnimationFrame(() => {
      const el = slideRefs.current.today;
      if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    const handleBack = async () => {
      const cancelBtn = document.querySelector("[data-confirm-cancel='true']");
      if (cancelBtn) {
        cancelBtn.click();
        return;
      }
      if (showSettingsSheet) {
        setShowSettingsSheet(false);
        return;
      }
      if (showIntroAgain) {
        setShowIntroAgain(false);
        return;
      }
      const dirtyForm = document.querySelector("[data-dirty-form='true']");
      if (dirtyForm) {
        const cancel = dirtyForm.querySelector("[data-form-cancel='true']");
        const ok = window.confirm("작성 중인 내용이 있습니다. 닫을까요? / You have unsaved changes. Close it?");
        if (!ok) return;
        if (cancel) cancel.click();
        return;
      }
      const activeEl = document.activeElement;
      if (activeEl && activeEl.matches?.("input, textarea, select, [contenteditable='true']")) {
        activeEl.blur();
        return;
      }
      if (tab === "act" && actCurrentView !== "overview") {
        setActInitialView(null);
        setActCurrentView("overview");
        setActResetSignal((v) => v + 1);
        return;
      }
      const activeScroll = slideRefs.current[tab];
      if (tab === "today") {
        if (activeScroll && activeScroll.scrollTop > 16) {
          activeScroll.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        try { await CapApp.exitApp(); } catch (e) { /* browser preview: ignore */ }
        return;
      }
      returnToToday();
    };

    let nativeListener;
    CapApp.addListener("backButton", handleBack)
      .then((listener) => { nativeListener = listener; })
      .catch(() => { /* browser preview/no native bridge */ });

    const onPopState = () => {
      if (tab !== "today" || showSettingsSheet || showIntroAgain) {
        returnToToday();
      }
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      if (nativeListener?.remove) nativeListener.remove();
      window.removeEventListener("popstate", onPopState);
    };
  }, [tab, actCurrentView, showSettingsSheet, showIntroAgain, returnToToday]);

  const handleTouchStart = (e) => {
    const locked = e.target.closest && e.target.closest("input, textarea, select, button, a, [contenteditable='true'], [data-no-tab-swipe='true'], [role='dialog'], [role='menu']");
    if (locked || document.activeElement?.matches?.("input, textarea, select, [contenteditable='true']")) { dragStartRef.current = null; return; }
    const touch = e.touches[0];
    dragStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    draggingRef.current = false;
    setLive(false);
    setDragPx(0);
  };
  const handleTouchMove = (e) => {
    if (!dragStartRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragStartRef.current.x;
    const dy = touch.clientY - dragStartRef.current.y;
    if (!draggingRef.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        draggingRef.current = true;
        setLive(true);
      } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.1) {
        dragStartRef.current = null; // decisively vertical — let the page scroll normally
        return;
      } else {
        return; // still ambiguous — wait for a clearer read before deciding either way
      }
    }
    e.preventDefault(); // once we've claimed the gesture, don't let any descendant (e.g. a button) interfere
    let clamped = dx;
    if (tabIndex === 0 && dx > 0) clamped = dx * 0.35; // rubber-band at the edges
    if (tabIndex === tabs.length - 1 && dx < 0) clamped = dx * 0.35;
    setDragPx(clamped);
  };
  const handleTouchEnd = () => {
    if (!draggingRef.current) { dragStartRef.current = null; return; }
    // A quick short flick completes the swipe too — doesn't need to cross
    // the full drag-distance threshold, just needs to be fast.
    const elapsed = Date.now() - (dragStartRef.current?.time || Date.now());
    const isFlick = elapsed < 250 && Math.abs(dragPx) > 36;
    const threshold = isFlick ? 42 : trackWidth * 0.25;
    setLive(false);
    if (dragPx <= -threshold && tabIndex < tabs.length - 1) {
      setTab(tabs[tabIndex + 1].id);
    } else if (dragPx >= threshold && tabIndex > 0) {
      setTab(tabs[tabIndex - 1].id);
    }
    setDragPx(0);
    dragStartRef.current = null;
    draggingRef.current = false;
  };

  if (!loaded) {
    const pulse = (h, w = "100%") => (
      <div style={{
        height: h, width: w, borderRadius: 12, background: theme.darkPanel2 || theme.surfaceRaised,
        animation: "hlSkeletonPulse 1.4s ease-in-out infinite",
      }} />
    );
    return (
      <div style={{ background: theme.bg, height: "var(--app-viewport-height, 100vh)", fontFamily: BODY_FONT_STACK, padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14 }}>
        <style>{`@keyframes hlSkeletonPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }`}</style>
        {pulse(20, "40%")}
        {pulse(120)}
        {pulse(90)}
        {pulse(70)}
      </div>
    );
  }

  return (
    <LangContext.Provider value={lang}>
    <ThemeContext.Provider value={theme}>
    {(!settings.hasOnboarded || showIntroAgain) && (
      <Onboarding
        settings={settings}
        onSaveSettings={saveSettings}
        isFirstTime={!settings.hasOnboarded}
        onDone={() => setShowIntroAgain(false)}
      />
    )}
    <div style={{
      background: theme.isDark ? `radial-gradient(circle at -20% 12%, ${tint(theme.progress || theme.run, 0.18)}, transparent 32%), radial-gradient(circle at 110% 10%, ${tint(theme.act || theme.lift, 0.12)}, transparent 30%), ${theme.bg}` : `radial-gradient(circle at -18% 12%, ${tint(theme.progress || theme.run, 0.12)}, transparent 32%), radial-gradient(circle at 112% 5%, ${tint(theme.plan || theme.ring, 0.14)}, transparent 30%), ${theme.bg}`,
      height: "var(--app-viewport-height, 100vh)", overflow: "hidden", color: theme.text,
      fontFamily: BODY_FONT_STACK, fontWeight: 500,
      display: "flex", flexDirection: "column", position: "relative",
    }}>
      <div style={{ position: "relative", minHeight: 46, padding: "5px 52px 5px 16px", textAlign: "left", background: theme.bg, backdropFilter: "blur(10px)", borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "center", justifyContent: "flex-start", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 10, background: `linear-gradient(135deg, ${theme.progress || theme.run}, ${theme.act || theme.lift})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#FAF7F0", fontWeight: 950, fontSize: 15, lineHeight: 1, letterSpacing: "-0.04em", paddingTop: 1, boxShadow: `0 7px 18px ${tint(theme.act || theme.lift, 0.16)}` }}>H</div>
          <div>
            <div style={{ fontSize: 17, lineHeight: 1.02, fontWeight: 850, letterSpacing: "-0.045em", fontFamily: MASTHEAD_FONT_STACK, color: theme.text }}>Hybrid Log</div>
            
          </div>
        </div>
        <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 2 }}>
          {showScrollTop && (
            <button
              onClick={scrollActiveTabToTop}
              aria-label="Scroll to top"
              title={t("상단으로", "Back to top")}
              style={{ width: 36, height: 36, padding: 0, borderRadius: 12, cursor: "pointer", background: "transparent", border: "none", color: theme.textDim, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <ChevronUp size={17} />
            </button>
          )}
          <button
            onClick={() => setShowSettingsSheet(true)}
            aria-label="Settings"
            title={t("설정", "Settings")}
            style={{ width: 36, height: 36, padding: 0, borderRadius: 12, cursor: "pointer", background: "transparent", border: "none", color: theme.textDim, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </div>

      {err && (
        <div style={{ margin: "8px 16px 0", background: tint(theme.danger, 0.14), border: `1px solid ${theme.danger}`, borderRadius: 12, padding: "8px 12px", fontSize: 12, color: theme.danger, display: "flex", justifyContent: "space-between" }}>
          {err}
          <button onClick={() => setErr(null)} style={{ background: "none", border: "none", color: theme.danger, cursor: "pointer" }}><X size={13} /></button>
        </div>
      )}

      <div
        ref={trackWrapRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ flex: 1, overflow: "hidden", maxWidth: 520, width: "100%", margin: "0 auto", position: "relative" }}
      >
        <div style={{
          display: "flex",
          height: "100%",
          width: trackWidth * tabs.length,
          transform: `translateX(${-tabIndex * trackWidth + dragPx}px)`,
          transition: live ? "none" : "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
        }}>
          {tabs.map((tb) => (
            <div key={tb.id}
              ref={(el) => { slideRefs.current[tb.id] = el; }}
              onScroll={(e) => { if (tb.id === tab) setShowScrollTop(e.currentTarget.scrollTop > 150); }}
              style={{ width: trackWidth, flexShrink: 0, height: "100%", overflowY: "auto", boxSizing: "border-box", padding: 16, paddingBottom: "calc(120px + env(safe-area-inset-bottom))", scrollPaddingBottom: 180, overscrollBehavior: "contain" }}>
              {tb.id === "today" && <TodayTab settings={settings} bodycomp={bodycomp} recentAvgSteps={recentAvgSteps} currentSteps={currentSteps} stepTrackingEnabled={stepTrackingEnabled} goToTab={goToTab} openActView={openActView} workouts={workouts} nutrition={nutrition} dayLogs={dayLogs} />}
              {tb.id === "act" && <ActTab workouts={workouts} setWorkouts={setWorkouts} programs={programs} bodycomp={bodycomp} setBodycomp={setBodycomp} dayLogs={dayLogs} setDayLogs={setDayLogs} initialView={actInitialView} onConsumedInitialView={() => setActInitialView(null)} resetSignal={actResetSignal} onViewChange={setActCurrentView} currentSteps={currentSteps} stepTrackingEnabled={stepTrackingEnabled} />}
              {tb.id === "eat" && <NutritionTab settings={settings} bodycomp={bodycomp} workouts={workouts} nutrition={nutrition} setNutrition={setNutrition} customFoods={customFoods} setCustomFoods={setCustomFoods} recentAvgSteps={recentAvgSteps} resetSignal={eatResetSignal} />}
              {tb.id === "plan" && <PlanTab settings={settings} onSaveSettings={saveSettings} bodycomp={bodycomp} nutrition={nutrition} workouts={workouts} programs={programs} weekPlan={weekPlan} setWeekPlan={setWeekPlan} setPrograms={setPrograms} recentAvgSteps={recentAvgSteps} tdeeHistory={tdeeHistory} setTdeeHistory={setTdeeHistory} resetSignal={planResetSignal} />}
              {tb.id === "progress" && <ProgressTab settings={settings} onSaveSettings={saveSettings} bodycomp={bodycomp} setBodycomp={setBodycomp} nutrition={nutrition} workouts={workouts} weekPlan={weekPlan} tdeeHistory={tdeeHistory} setTdeeHistory={setTdeeHistory} recentAvgSteps={recentAvgSteps} />}
            </div>
          ))}
        </div>
      </div>

      <SettingsSheet open={showSettingsSheet} onClose={() => setShowSettingsSheet(false)}>
        <SettingsTab settings={settings} onSaveSettings={saveSettings} workouts={workouts} nutrition={nutrition} bodycomp={bodycomp} programs={programs} onShowIntro={() => setShowIntroAgain(true)} />
      </SettingsSheet>

      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: `linear-gradient(180deg, ${tint(theme.bg, 0.92)}, ${theme.bg})`, backdropFilter: "blur(14px)", borderTop: `1px solid ${theme.border}`,
        display: "flex", justifyContent: "center",
        boxShadow: "0 -12px 28px rgba(0,0,0,0.28)",
      }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 520, padding: "4px 6px env(safe-area-inset-bottom)" }}>
          {tabs.map((tabItem) => {
            const Icon = tabItem.icon;
            const active = tab === tabItem.id;
            return (
              <button key={tabItem.id} onClick={() => goToTab(tabItem.id, { reset: ["act", "eat", "plan"].includes(tabItem.id) })}
                style={{
                  flex: 1, background: active ? `linear-gradient(135deg, ${tint(tabItem.color || theme.ring, 0.24)}, ${theme.darkPanel2 || theme.surface})` : "transparent", border: active ? `1px solid ${tint(tabItem.color || theme.ring, 0.38)}` : "1px solid transparent", padding: "8px 4px 9px",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  color: active ? (tabItem.color || theme.ring) : theme.textFaint, cursor: "pointer", borderRadius: 13,
                }}>
                <Icon size={18} style={{ animation: active ? "hlTabBounce 0.35s ease" : "none" }} />
                <span style={{ fontSize: 12, fontWeight: active ? 700 : 500 }}>{tabItem.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
    </ThemeContext.Provider>
    </LangContext.Provider>
  );
}

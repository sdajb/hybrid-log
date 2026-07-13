import React, { useState, useEffect, useMemo, useCallback, useRef, useContext, createContext } from "react";
import { createPortal } from "react-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Dumbbell, Activity, Utensils, Scale, TrendingUp, Plus, Trash2, X, Footprints, Smile, Clock, Award, BarChart3,
  Check, Settings2, ChevronRight, ChevronUp, ChevronDown, GripVertical, Flame, Search, Calculator, Pencil, Moon, BedDouble,
} from "lucide-react";
import { Haptics } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";
import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";

// Our own custom native plugin (Android only — see
// android/app/src/main/java/.../StepCounterPlugin.java). No npm package;
// registerPlugin() bridges to it by name. Safely rejects in the browser
// preview / artifact (no native bridge), which callers below handle.
const BUILD_RELEASE = "0.14.49-web";
const StepCounterPlugin = registerPlugin("StepCounter");
const RestTimerPlugin = registerPlugin("RestTimer");
const WEB_BUILD = true;
const PATCH_NOTES_URL = "/hybrid-log/patch-notes.html";
const PATCH_NOTES_SEEN_KEY = `hybridLog.patchNotesSeen.${BUILD_RELEASE}`;

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

// Foreground rest-finish sound. The native RestTimerService only rings when the
// app is backgrounded; in the foreground the JS timer advances first and stops
// the native timer before its notification fires, so we synthesize the alarm
// here with Web Audio. getAudioCtx() is also called on user gestures (logging a
// set) so the context is unlocked by the time the timer completes.
let __audioCtx = null;
function getAudioCtx() {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!__audioCtx) __audioCtx = new Ctor();
    if (__audioCtx.state === "suspended") __audioCtx.resume().catch(() => {});
    return __audioCtx;
  } catch (e) { return null; }
}
function playRestFinishSound(sound) {
  if (sound === "vibrate") { haptic(); return; }
  const ctx = getAudioCtx();
  if (!ctx) { haptic(); return; }
  try {
    const now = ctx.currentTime;
    const pattern = sound === "buzzer" ? [[196, 0, 0.45]]
      : sound === "digital" ? [[988, 0, 0.1], [988, 0.16, 0.1], [988, 0.32, 0.14]]
      : [[660, 0, 0.14], [988, 0.15, 0.28]];
    const wave = sound === "buzzer" ? "sawtooth" : "sine";
    pattern.forEach(([freq, t0, dur]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = wave; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + t0);
      gain.gain.exponentialRampToValueAtTime(0.5, now + t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + t0); osc.stop(now + t0 + dur + 0.03);
    });
  } catch (e) { /* ignore */ }
  haptic();
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

async function startNativeRestTimer(seconds, sound = "classic") {
  try {
    await RestTimerPlugin.start({ seconds: Math.max(1, Math.round(seconds)), sound });
    return true;
  } catch (e) {
    return scheduleRestTimerNotification(seconds, "Rest's over!", "Time for the next set.");
  }
}
async function stopNativeRestTimer() {
  try { await RestTimerPlugin.stop(); } catch (e) { /* native plugin unavailable */ }
  await cancelRestTimerNotification();
}
async function getNativeRestTimerState() {
  try { return await RestTimerPlugin.getState(); } catch (e) { return { running: false, endsAt: 0, skipped: false }; }
}

/* ---------------------------------------------------------
   COLOR PALETTES — clean modern themes. Each has the same shape
   so every component can just do `const theme = useTheme();`
--------------------------------------------------------- */
// Monochrome + single amber accent, editorial-athletic direction.
// Near-black surfaces, one warm amber for every accent/CTA, everything else
// grayscale. Semantic keys (act/eat/plan/progress/checkin) all collapse to
// amber so the whole app reads as one accent rather than color-coded tabs.
const AMBER = "#E6B22E";
const AMBER_DEEP = "#C8971F";
const PALETTES = {
  dark: {
    name: "Dark", isDark: true,
    bg: "#0A0A0A", surface: "#121212", surfaceRaised: "#1A1A1A", border: "#292929",
    text: "#F5F5F3", textDim: "#A8A8A4", textFaint: "#6E6E6A",
    lift: AMBER, run: "#F5F5F3", rest: "#1A1A1A", danger: "#E5533B",
    gradA: AMBER, gradB: AMBER_DEEP, ring: AMBER, heroText: "#0A0A0A", heroTextDim: "#3A2E12",
    act: AMBER, eat: AMBER, plan: AMBER, progress: AMBER, checkin: AMBER,
    cream: "#F5F5F3", cream2: "#FFFFFF", darkPanel: "#141414", darkPanel2: "#1A1A1A",
    rust: "#E5533B", mustard: AMBER, teal: "#A8A8A4", brown: "#1A1A1A",
    stripe: [AMBER, "#F5F5F3", "#6E6E6A", "#292929"],
  },
  light: {
    name: "Light", isDark: false,
    bg: "#F4F3F0", surface: "#FFFFFF", surfaceRaised: "#FAFAF8", border: "#DEDDD8",
    text: "#141414", textDim: "#5C5C58", textFaint: "#8E8E88",
    lift: AMBER_DEEP, run: "#141414", rest: "#ECEBE6", danger: "#C8401F",
    gradA: AMBER, gradB: AMBER_DEEP, ring: AMBER_DEEP, heroText: "#0A0A0A", heroTextDim: "#3A2E12",
    act: AMBER_DEEP, eat: AMBER_DEEP, plan: AMBER_DEEP, progress: AMBER_DEEP, checkin: AMBER_DEEP,
    cream: "#FFFFFF", cream2: "#FFFFFF", darkPanel: "#ECEBE6", darkPanel2: "#F4F3F0",
    rust: "#C8401F", mustard: AMBER_DEEP, teal: "#5C5C58", brown: "#141414",
    stripe: [AMBER_DEEP, "#141414", "#8E8E88", "#DEDDD8"],
  },
};
const DEFAULT_PALETTE = "dark";

// Editorial-athletic typography system:
//  - SANS: large numerals, body, UI. Clean grotesque.
//  - MONO: uppercase context labels ("SET 2 OF 4", "WEIGHT [KG]") — wide tracking.
//  - SERIF: italic block/section titles ("Development Block: Week 5 of 12").
const FONT_STACK = "'Inter', 'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, -apple-system, sans-serif";
const MONO_FONT_STACK = "'JetBrains Mono', 'IBM Plex Mono', 'Roboto Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace";
const SERIF_FONT_STACK = "'Newsreader Variable', 'Newsreader', 'IBM Plex Sans KR', 'Apple SD Gothic Neo', Georgia, serif";
const MASTHEAD_FONT_STACK = SERIF_FONT_STACK;
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
// Parse a "YYYY-MM-DD" string as LOCAL midnight. Bare `new Date("2025-07-10")`
// parses as UTC midnight, which is the previous local day in timezones ahead
// of UTC (e.g. KST) — shifting window filters by a day at the boundary. Passes
// Date objects and full ISO timestamps through unchanged.
function parseLocalDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
}
const fmtDate = (d) => {
  const dt = parseLocalDate(d);
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
  // Always-English helper for editorial section labels / mono uppercase
  // "instrument labels", which stay English regardless of UI language.
  const en = (_ko, enStr) => enStr;
  return { lang, t, en };
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
  const bc = [...bodycomp].filter((b) => parseLocalDate(b.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  const nu = nutrition.filter((n) => parseLocalDate(n.date) >= cutoff);
  if (bc.length < 2 || nu.length < 3) return null;
  const first = bc[0], last = bc[bc.length - 1];
  const days = (parseLocalDate(last.date) - parseLocalDate(first.date)) / 86400000;
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
    const daysSince = (nowDate() - parseLocalDate(lastProposalDateStr)) / 86400000;
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
  const recent = workouts.filter((w) => parseLocalDate(w.date) >= cutoff && (getDurationMin(w) || 0) > 0);
  const totalKcal = recent.reduce((sum, w) => {
    const netMet = Math.max(0, metForWorkout(w) - 1);
    const hours = (getDurationMin(w) || 0) / 60;
    return sum + netMet * weightKg * hours;
  }, 0);
  return totalKcal / (windowDays / 7); // normalized to a weekly average
}

function computeInitialTdee(settings, currentWeight, workouts, recentAvgSteps, currentBodyFat = null) {
  if (!currentWeight) return null;
  let bmr = null;
  let bmrMethod = "weight_fallback";
  if (settings.ageYears && settings.heightCm) {
    bmr = bmrMifflin(settings.sex || "male", settings.ageYears, settings.heightCm, currentWeight);
    bmrMethod = "mifflin";
  } else {
    const ffm = fatFreeMassKg(currentWeight, currentBodyFat ?? settings.startBF);
    if (ffm != null) {
      bmr = 370 + 21.6 * ffm;
      bmrMethod = "katch_mcardle";
    } else {
      bmr = currentWeight * (settings.sex === "female" ? 21 : 22);
      bmrMethod = "weight_fallback";
    }
  }
  const activityFactorValue = resolveActivityFactor(settings, recentAvgSteps);
  const nonExercise = bmr * activityFactorValue;
  const exerciseKcal = weeklyNetExerciseKcal(workouts, currentWeight) / 7;
  return { bmr, tdee: nonExercise + exerciseKcal, bmrMethod, activityFactor: activityFactorValue };
}

// Blend the model-based initial estimate with an observed estimate from two
// 7-day blocks of logged weight + intake — bounded to ±30% of the initial
// estimate so short-term water/glycogen noise can't throw it off a cliff.
function calibrateTdee(initialTdee, bodycomp, nutrition, windowDays = 14) {
  const cutoff = nowDate();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const bc = [...bodycomp].filter((b) => parseLocalDate(b.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  const nu = nutrition.filter((n) => parseLocalDate(n.date) >= cutoff);
  const dailyTotals = {};
  nu.forEach((n) => { dailyTotals[n.date] = (dailyTotals[n.date] || 0) + (+n.calories || 0); });
  const loggedDays = Object.keys(dailyTotals).length;
  if (bc.length < 2 || loggedDays < 7) return { eligible: false };

  const mid = new Date(cutoff);
  mid.setDate(mid.getDate() + windowDays / 2);
  const firstHalf = bc.filter((b) => parseLocalDate(b.date) < mid);
  const secondHalf = bc.filter((b) => parseLocalDate(b.date) >= mid);
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
    const daysSinceAccepted = (today - parseLocalDate(lastAcceptedDateStr)) / 86400000;
    if (daysSinceAccepted < 7) {
      return { eligible: false, note: t("최근 보정을 승인한 지 7일이 지나야 다음 제안이 나와요.", "Wait at least 7 days after the last accepted calibration before the next proposal.") };
    }
  }

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (CALIBRATION_WINDOW_DAYS - 1));

  const byDate = {};
  nutrition.forEach((n) => {
    if (parseLocalDate(n.date) < cutoff) return;
    if (!byDate[n.date]) byDate[n.date] = { cal: 0, qSum: 0, qCount: 0 };
    byDate[n.date].cal += (+n.calories || 0);
    byDate[n.date].qSum += (n.quality ?? 0.8);
    byDate[n.date].qCount += 1;
  });
  const intakeDays = Object.values(byDate).map((d) => ({ cal: d.cal, quality: d.qSum / d.qCount }));
  const reliableIntake = intakeDays.filter((d) => d.quality >= MIN_INTAKE_QUALITY);
  const meanQuality = reliableIntake.length ? reliableIntake.reduce((s, d) => s + d.quality, 0) / reliableIntake.length : 0;

  const fastedWeights = bodycomp.filter((b) => parseLocalDate(b.date) >= cutoff && (b.condition ?? "unknown") === "fasted");

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
  const points = fastedWeights.map((b) => [parseLocalDate(b.date).getTime() / 86400000, b.weight]);
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
// Single source of truth for a cut target + all safety clamps. Returns the
// target plus enough detail (the applied deficit, which bound bit, and the
// resulting real weekly rate) that callers never re-derive the floor logic —
// keeping every screen's number and its on-screen explanation in sync.
function computeCutTarget(tdee, weightKg, weeklyChangeFraction, bmr, sex) {
  const requestedDeficit = (weightKg * weeklyChangeFraction * KCAL_PER_KG) / 7;
  // Upper caps only (900 kcal + 30%-of-TDEE) keep an aggressive rate% on a
  // heavy bodyweight safe. No lower floor on the deficit — a gentle tier must
  // stay gentle rather than being silently bumped up to a minimum. The BMR /
  // clinical floor below still protects the downside.
  const cappedDeficit = Math.min(Math.max(requestedDeficit, 0), 900, tdee * 0.30);
  const clinicalFloor = sex === "female" ? 1200 : 1500;
  const floorVal = Math.max(clinicalFloor, Number(bmr) || 0);
  const rawTarget = tdee - cappedDeficit;
  const target = Math.max(rawTarget, floorVal);
  const appliedDeficit = tdee - target;
  const effectiveRateFrac = weightKg > 0 ? (appliedDeficit * 7) / KCAL_PER_KG / weightKg : 0;
  return {
    target,
    requestedDeficit,
    appliedDeficit,
    floorVal,
    effectiveRateFrac,
    flooredByIntake: rawTarget < floorVal - 0.5,           // clamped up to the intake floor
    deficitCapped: cappedDeficit < requestedDeficit - 0.5, // 900 / 30%-of-TDEE cap bit first
  };
}
// Thin wrapper for callers that only need the number.
function dailyTargetForRate(tdee, weightKg, weeklyChangeFraction, bmr, sex) {
  return computeCutTarget(tdee, weightKg, weeklyChangeFraction, bmr, sex).target;
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
function specialDayBudget(tdeeKcal, normalDailyTargetKcal, specialDaysPerWeek = 1, bmr = 0, sex = "male") {
  const weeklyBudget = normalDailyTargetKcal * 7;
  const desiredSpecial = Math.min(normalDailyTargetKcal + 500, tdeeKcal * 1.10);
  const clinicalFloor = sex === "female" ? 1200 : 1500;
  const normalFloor = Math.max(clinicalFloor, Number(bmr) || 0);
  const normalDays = Math.max(1, 7 - specialDaysPerWeek);
  const maxSpecialFromFloor = weeklyBudget - normalFloor * normalDays;
  const special = Math.max(normalDailyTargetKcal, Math.min(desiredSpecial, maxSpecialFromFloor));
  const normal = (weeklyBudget - special * specialDaysPerWeek) / normalDays;
  return { special: Math.round(special), normal: Math.round(normal) };
}

function weekStartKey(date = nowDate()) {
  const d = parseLocalDate(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return localDateStr(d);
}
function applyCheatDayTarget(settings, activeTarget, effectiveTdee, bmr) {
  if (!activeTarget || !effectiveTdee || activeTarget.mode !== "cut") return activeTarget;
  const currentWeek = weekStartKey();
  if (settings.cheatDayUsedWeekKey !== currentWeek || !settings.cheatDayUsedDate) return activeTarget;
  const budget = specialDayBudget(effectiveTdee, activeTarget.target, 1, bmr, settings.sex);
  const isCheat = settings.cheatDayActive && settings.cheatDayUsedDate === todayStr();
  return { ...activeTarget, target: isCheat ? budget.special : budget.normal, cheatDay: isCheat, cheatBudget: budget, normalTarget: activeTarget.target };
}
function shouldReclaimUnusedCheatDay(settings, nutrition, normalTarget, date = todayStr()) {
  if (!settings?.cheatDayActive) return false;
  if (settings.cheatDayUsedDate !== date) return false;
  if (settings.cheatDayUsedWeekKey !== weekStartKey(parseLocalDate(date))) return false;
  const normal = Number(normalTarget);
  if (!Number.isFinite(normal) || normal <= 0) return false;
  const consumed = (nutrition || [])
    .filter((n) => n.date === date)
    .reduce((sum, n) => sum + (+n.calories || 0), 0);
  return consumed <= normal + 0.5;
}
function reclaimCheatDaySettings(settings) {
  return {
    ...settings,
    cheatDayEnabled: false,
    cheatDayActive: false,
    cheatDayWeekKey: "",
    cheatDayDate: "",
    cheatDayUsedWeekKey: "",
    cheatDayUsedDate: "",
  };
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

function macrosFor(rawTargetKcal, weightKg, sex, bodyFatPercent, carbPercent = null) {
  // Compute macros against the same rounded target the UI shows, so the macro
  // breakdown and the displayed calorie number stay consistent.
  const targetKcal = Math.round(rawTargetKcal);
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

// `bmr` is the engine's best BMR estimate (Mifflin → Katch-McArdle → weight
// fallback) — passed in by every caller so the intake floor is identical on
// every screen, rather than each screen re-deriving its own.
function computeActiveTarget(settings, effectiveTdee, currentWeight, currentBF, bmr = null) {
  if (!effectiveTdee || !currentWeight) return null;
  const mode = settings.goalMode || "cut";
  const carbPercent = settings.carbPercent ?? null;
  const medicalBlock = settings.pregnantOrBreastfeeding || settings.edRecoveryOrClinical;
  if (mode === "cut" && medicalBlock) {
    // Don't compute or suggest a specific deficit target — this mirrors
    // DietEngineV3's safetyWarnings REVIEW_REQUIRED gate for pregnancy/
    // breastfeeding and ED-recovery/clinical-restriction contexts.
    const macros = macrosFor(effectiveTdee, currentWeight, settings.sex, currentBF, carbPercent);
    return { mode, tierKey: null, target: effectiveTdee, macros, blocked: true, floorInfo: null };
  }
  let target, tierKey, tierDef, floorInfo = null;
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
    const cut = computeCutTarget(effectiveTdee, currentWeight, tierDef.frac, bmr, settings.sex);
    target = cut.target;
    floorInfo = cut;
  }
  const macros = macrosFor(target, currentWeight, settings.sex, currentBF, carbPercent);
  return { mode, tierKey, target, macros, blocked: false, floorInfo };
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
  const initial = computeInitialTdee(settings, currentWeight, workouts, recentAvgSteps, bodycomp?.slice?.().sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).at?.(-1)?.bodyfat ?? settings.startBF ?? null);
  if (!initial) return null;
  const calib = calibrateTdee(initial.tdee, bodycomp, nutrition, 14);
  const effectiveTdee = calib.eligible ? calib.blendedTdee : initial.tdee;
  return { bmr: initial.bmr, bmrMethod: initial.bmrMethod, activityFactor: initial.activityFactor, initialTdee: initial.tdee, calibration: calib, effectiveTdee };
}

// The TDEE that targets are computed from — shared by every screen so they
// never disagree. Deliberately the accepted (or model) baseline rounded to
// 10 kcal, NOT engine.effectiveTdee's auto-blended observed value: targets
// shouldn't drift day to day from logged data alone. A calibration only takes
// effect once the user explicitly accepts it (settings.acceptedTdee).
function targetTdee(settings, engine) {
  if (!engine) return null;
  return settings.acceptedTdee ?? Math.round(engine.initialTdee / 10) * 10;
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

function weekPlanIndexForDate(dateKey) {
  const d = parseLocalDate(dateKey);
  return (d.getDay() + 6) % 7; // Mon=0
}
function getPlannedDay(dateKey, weekPlan) {
  const idx = weekPlanIndexForDate(dateKey);
  return weekPlan?.[idx] || { kind: "rest" };
}
function hasCheckinData(entry) {
  return !!entry && (!!entry.mood || !!entry.energy || !!entry.sleep || !!String(entry.note || "").trim());
}
function hasRestCredit(entry) {
  return !!entry?.restCompleted;
}
function planWorkoutComplete(dateKey, plan, workouts, programs = []) {
  if (!plan || plan.kind === "rest") return false;
  return (workouts || []).some((w) => {
    if (w.date !== dateKey) return false;
    if (plan.kind === "lift") {
      const program = programs.find((p) => p.id === plan.programId);
      return w.type === "lift" && (w.programId === plan.programId || (program?.name && w.subtype === program.name));
    }
    if (plan.kind === "run") {
      return w.type === "run" && (!plan.runLabel || w.subtype === plan.runLabel);
    }
    return false;
  });
}
function consistencyCompleteForDate(dateKey, weekPlan, workouts, dayLogs, programs = []) {
  const plan = getPlannedDay(dateKey, weekPlan);
  const log = (dayLogs || []).find((d) => d.date === dateKey);
  if (plan.kind === "rest") return hasRestCredit(log) || hasCheckinData(log);
  return planWorkoutComplete(dateKey, plan, workouts, programs);
}
function calcConsistencyStreak(weekPlan, workouts, dayLogs, programs = []) {
  let count = 0;
  const cursor = nowDate();
  let key = localDateStr(cursor);
  if (!consistencyCompleteForDate(key, weekPlan, workouts, dayLogs, programs)) {
    cursor.setDate(cursor.getDate() - 1);
    key = localDateStr(cursor);
  }
  while (consistencyCompleteForDate(key, weekPlan, workouts, dayLogs, programs)) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
    key = localDateStr(cursor);
  }
  return count;
}
function calcWorkoutStreak(workouts) {
  const workoutDays = new Set((workouts || []).filter((w) => w.type === "lift" || w.type === "run").map((w) => w.date));
  let count = 0;
  const cursor = nowDate();
  if (!workoutDays.has(localDateStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (workoutDays.has(localDateStr(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

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
      { id: "ex_1", name: "인클라인/플랫 덤벨 프레스", nameEn: "Incline / Flat DB Press", sets: 2, repRange: "6-12", muscle: "chest", warmupSets: 1 },
      { id: "ex_2", name: "시티드 덤벨 숄더 프레스", nameEn: "Seated DB Shoulder Press", sets: 2, repRange: "6-12", muscle: "shoulders", warmupSets: 1 },
      { id: "ex_3", name: "딥스 (웨이트/머신)", nameEn: "Dips (Weighted / Machine)", sets: 2, repRange: "6-12", muscle: "triceps", warmupSets: 1 },
      { id: "ex_4", name: "펙덱 또는 케이블 플라이", nameEn: "Pec Deck or Cable Fly", sets: 2, repRange: "6-12", muscle: "chest", warmupSets: 1 },
    ],
  },
  {
    id: "legs", name: "Legs",
    exercises: [
      { id: "ex_5", name: "스쿼트", nameEn: "Squats", sets: 3, repRange: "4-6", muscle: "quads", warmupSets: 1 },
      { id: "ex_6", name: "RDL (바벨/덤벨)", nameEn: "RDL (Barbell / DB)", sets: 2, repRange: "8-10", muscle: "hamstrings", warmupSets: 1 },
      { id: "ex_7", name: "덤벨 런지", nameEn: "DB Lunges", sets: 2, repRange: "8-12", muscle: "quads", warmupSets: 1 },
      { id: "ex_8", name: "카프 레이즈", nameEn: "Calf Raises", sets: 2, repRange: "8-12", muscle: "calves", warmupSets: 1 },
    ],
  },
  {
    id: "pull", name: "Pull",
    exercises: [
      { id: "ex_9", name: "덤벨/바벨 로우", nameEn: "DB / BB Row", sets: 2, repRange: "6-12", muscle: "back", warmupSets: 1 },
      { id: "ex_10", name: "풀업 또는 랫 풀다운", nameEn: "Pull-Ups or Lat Pulldown", sets: 2, repRange: "6-12", muscle: "back", warmupSets: 1 },
      { id: "ex_11", name: "바벨 바이셉 컬", nameEn: "BB Biceps Curls", sets: 2, repRange: "8-10", muscle: "biceps", warmupSets: 1 },
      { id: "ex_12", name: "랫 풀오버", nameEn: "Lat Pullover", sets: 2, repRange: "10-12", muscle: "back", warmupSets: 1 },
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
const GUIDE_SETTINGS_KEY = "__guideSettings";
function guideSettingsKey(program) {
  return String(program?.id || program?.name || "default");
}
async function loadGuideSettings(program) {
  const stored = await loadKey("progressiveOverload", {});
  return stored?.[GUIDE_SETTINGS_KEY]?.[guideSettingsKey(program)] || null;
}
async function saveGuideSettings(program, settings) {
  const stored = await loadKey("progressiveOverload", {});
  const all = stored?.[GUIDE_SETTINGS_KEY] || {};
  await saveKey("progressiveOverload", {
    ...(stored || {}),
    [GUIDE_SETTINGS_KEY]: {
      ...all,
      [guideSettingsKey(program)]: {
        ...(all[guideSettingsKey(program)] || {}),
        ...settings,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

// Target rep count for the top/working sets. Session-based progression:
// starts at startReps and climbs by exactly 1 each time the exercise is
// completed in a guided session, capped at maxReps — matching "한 세션에
// 하나씩 올리기" (increase by one rep per session). Using a stored
// session counter (not elapsed calendar time) means a long layoff never
// makes the target jump several reps at once on the return session.
function currentTargetReps(poEntry, startReps, maxReps) {
  const step = Math.max(0, poEntry?.sessionsAtWeight ?? 0);
  return Math.min(maxReps, startReps + step);
}



const makeExercisesFromPlan = (planExercises, lang) => {
  if (!planExercises) return [];
  return planExercises.map((ex) => ({
    name: lang === "en" && ex.nameEn ? ex.nameEn : ex.name, repRange: ex.repRange, muscle: ex.muscle || null,
    sets: Array.from({ length: Math.max(1, Math.round(Number(ex.sets)) || 1) }, () => ({ weight: "", reps: "", setType: "working" })),
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
  restTimerSound: "classic",
  cheatDayEnabled: false,
  cheatDayActive: false,
  cheatDayWeekKey: "",
  cheatDayDate: "",
  cheatDayUsedWeekKey: "",
  cheatDayUsedDate: "",
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
const STORAGE_VERSION = 6;
const ALL_STORAGE_KEYS = [
  "settings", "bodycomp", "workouts", "nutrition", "tdeeHistory", "customFoods",
  "programs", "weekPlan", "dayLogs", "guidedSessionDraft", "workoutDraft", "runSessionDraft",
  "progressiveOverload", "restTimerSound", "stepBaseline", "stepHistory", "storageVersion",
];
async function resetAllData() {
  await Promise.all(ALL_STORAGE_KEYS.map((k) => deleteKey(k)));
}

async function collectBackupData() {
  const data = {};
  await Promise.all(ALL_STORAGE_KEYS.map(async (key) => {
    data[key] = await loadKey(key, null);
  }));
  return {
    app: "Hybrid Log",
    backupSchemaVersion: 1,
    storageVersion: STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}
async function copyTextToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // fallback below
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}
async function shareJsonBackup(text, filename) {
  try {
    const file = new File([text], filename, { type: "application/json" });
    if (navigator?.canShare?.({ files: [file] }) && navigator?.share) {
      await navigator.share({ files: [file], title: filename, text: "Hybrid Log backup" });
      return true;
    }
  } catch (e) {
    // continue to download fallback
  }
  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    return true;
  } catch (e) {
    return false;
  }
}
async function restoreBackupPayload(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid backup file");
  await Promise.all(ALL_STORAGE_KEYS.map(async (key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      if (data[key] == null) await deleteKey(key);
      else await saveKey(key, data[key]);
    } else {
      await deleteKey(key);
    }
  }));
  await saveKey("storageVersion", STORAGE_VERSION);
}

function migrateSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  if (!s.startDate) s.startDate = todayStr();
  if (!s.colorPalette || !PALETTES[s.colorPalette]) s.colorPalette = DEFAULT_PALETTE;
  if (!s.goalMode) s.goalMode = "cut";
  if (!s.activityLevel) s.activityLevel = "low";
  if (!s.cheatDayUsedWeekKey && s.cheatDayWeekKey && s.cheatDayDate) s.cheatDayUsedWeekKey = s.cheatDayWeekKey;
  if (!s.cheatDayUsedDate && s.cheatDayDate) s.cheatDayUsedDate = s.cheatDayDate;
  if (typeof s.cheatDayActive !== "boolean") s.cheatDayActive = !!s.cheatDayEnabled;
  s.storageVersion = STORAGE_VERSION;
  return s;
}
function migrateWorkoutEntry(w) {
  const base = { exercises: [], notes: "", duration: "", distance: "", hr: "", ...w, date: w?.date || todayStr(), type: w?.type || "lift", subtype: w?.subtype || "기타" };
  return {
    ...base,
    exercises: (base.exercises || []).map((ex) => ({
      ...ex,
      id: ex?.id || ex?.exerciseId || uid(),
      exerciseId: ex?.exerciseId || ex?.id || null,
      sets: (ex?.sets || []).map((set, index) => ({
        ...set,
        setType: set?.setType || "working",
        targetReps: set?.targetReps ?? null,
        setNumber: set?.setType === "warmup" ? null : (set?.setNumber ?? index + 1),
      })),
    })),
  };
}

function migratePrograms(programs) {
  return (programs || DEFAULT_PROGRAMS).map((program) => ({
    ...program,
    id: program?.id || uid(),
    exercises: (program?.exercises || []).map((ex) => ({
      ...ex,
      id: ex?.id || uid(),
      warmupSets: Math.max(0, Math.min(5, Number(ex?.warmupSets ?? 1))),
      sets: Math.max(1, Number(ex?.sets ?? 2)),
      repRange: ex?.repRange || "6-12",
    })),
  }));
}
const MEAL_CATEGORIES = ["breakfast", "lunch", "dinner", "snack", "other"];
function inferMealCategory(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "other";
  if (["breakfast", "아침", "morning"].some((x) => raw.includes(x))) return "breakfast";
  if (["lunch", "점심", "brunch"].some((x) => raw.includes(x))) return "lunch";
  if (["dinner", "저녁", "evening", "supper"].some((x) => raw.includes(x))) return "dinner";
  if (["snack", "간식", "dessert", "디저트"].some((x) => raw.includes(x))) return "snack";
  if (MEAL_CATEGORIES.includes(raw)) return raw;
  return "other";
}
function mealCategoryLabel(id, t) {
  return {
    breakfast: t("아침", "Breakfast"),
    lunch: t("점심", "Lunch"),
    dinner: t("저녁", "Dinner"),
    snack: t("간식", "Snack"),
    other: t("기타", "Other"),
  }[id] || t("기타", "Other");
}
function mealCategoryOrder(id) {
  const idx = MEAL_CATEGORIES.indexOf(id);
  return idx >= 0 ? idx : MEAL_CATEGORIES.length;
}
function groupedNutritionItems(items) {
  const map = {};
  (items || []).forEach((item) => {
    const cat = item.mealCategory || inferMealCategory(item.meal);
    if (!map[cat]) map[cat] = [];
    map[cat].push(item);
  });
  return Object.entries(map).sort((a, b) => mealCategoryOrder(a[0]) - mealCategoryOrder(b[0]));
}
function mealCategoryCount(items) {
  return groupedNutritionItems(items).length;
}
function migrateNutritionEntry(n) {
  const originalMeal = n?.meal || "";
  const hasExplicitCategory = !!n?.mealCategory;
  const inferred = hasExplicitCategory ? n.mealCategory : inferMealCategory(originalMeal);
  const keepName = hasExplicitCategory || inferred === "other" ? originalMeal : "";
  return {
    mealCategory: inferred,
    meal: keepName,
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    quality: null,
    ...n,
    mealCategory: n?.mealCategory || inferred,
    meal: n?.meal ?? keepName,
    date: n?.date || todayStr(),
  };
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
  const programs = migratePrograms(await loadKey("programs", DEFAULT_PROGRAMS));
  await Promise.all([
    saveKey("settings", settings),
    saveKey("workouts", workouts),
    saveKey("nutrition", nutrition),
    saveKey("bodycomp", bodycomp),
    saveKey("programs", programs),
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
  const isBare = variant === "bare"; // no top rule (for standalone/nested use)
  const accentColor = accent || theme.ring;
  // Editorial spread: sections are NOT boxes. Each section is delineated by a
  // single hairline rule at the top and generous vertical breathing room, so
  // the type hierarchy — not card chrome — carries the structure. The feature
  // variant swaps the neutral rule for an amber one to draw the eye; quiet
  // keeps a fainter rule for secondary/supporting blocks.
  const {
    padding: padOverride, background: bgOverride, border: borderOverride,
    borderRadius: radiusOverride, marginTop, marginBottom, ...restStyle
  } = style || {};
  const ruleColor = isFeature ? accentColor : (isQuiet ? theme.border : theme.border);
  const ruleWeight = isFeature ? 2 : 1;
  return (
    <div
      style={{
        position: "relative",
        paddingTop: isBare ? 0 : 16,
        paddingBottom: 2,
        borderTop: isBare ? "none" : `${ruleWeight}px solid ${ruleColor}`,
        marginTop: marginTop ?? 0,
        marginBottom: marginBottom ?? 0,
        boxSizing: "border-box",
        ...restStyle,
      }}
      {...rest}
    >{children}</div>
  );
}

// A hairline horizontal rule for editorial section separation.
function RuleLine({ style }) {
  const theme = useTheme();
  return <div style={{ height: 1, background: theme.border, width: "100%", ...style }} />;
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
  return (
    <div style={{ position: "relative", padding: "2px 2px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          {eyebrow && <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.22em", textTransform: "uppercase", color: theme.textFaint, marginBottom: 9, fontFamily: MONO_FONT_STACK }}>{eyebrow}</div>}
          <div style={{ fontSize: 36, fontWeight: 500, fontStyle: "italic", letterSpacing: "-0.015em", lineHeight: 0.98, color: theme.text, fontFamily: SERIF_FONT_STACK }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: theme.textDim, marginTop: 11, lineHeight: 1.45 }}>{subtitle}</div>}
        </div>
        {children}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 15 }}>
        <div style={{ height: 2, width: 40, background: theme.lift, borderRadius: 1 }} />
        <div style={{ height: 1, flex: 1, background: theme.border }} />
      </div>
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "8px 2px 12px" }}>
      <div style={{ fontSize: 11.5, lineHeight: 1.3, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", color: theme.textDim, fontFamily: MONO_FONT_STACK }}>{children}</div>
      {right}
    </div>
  );
}

function StatusCallout({ tone = "info", children, style }) {
  const theme = useTheme();
  const color = tone === "danger" ? theme.danger : tone === "run" ? theme.run : tone === "lift" ? theme.lift : theme.ring;
  return (
    <div style={{ borderLeft: `2px solid ${color}`, background: "transparent", padding: "4px 0 4px 12px", color: theme.text, fontSize: 13, lineHeight: 1.5, ...style }}>{children}</div>
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
  borderRadius: 2,
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
          borderRadius: 2,
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
                borderRadius: 2,
                background: active ? tint(theme.ring, 0.14) : "transparent",
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

// Flat segmented toggle: square 2px corners, no gradient. Selected = amber
// fill with near-black text; unselected = hairline outline. Used for all
// segmented controls so they read as one flat editorial system.
function FlatToggle({ selected, onClick, children, style }) {
  const theme = useTheme();
  return (
    <button onClick={onClick} style={{
      flex: 1, minHeight: 46, borderRadius: 2, cursor: "pointer",
      border: `1px solid ${selected ? theme.lift : theme.border}`,
      background: selected ? theme.lift : "transparent",
      color: selected ? (theme.heroText || "#0A0A0A") : theme.textDim,
      fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
      fontFamily: MONO_FONT_STACK,
      ...style,
    }}>{children}</button>
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
        background: disabled ? theme.surfaceRaised : theme.lift,
        color: disabled ? theme.textFaint : (theme.heroText || "#0A0A0A"),
        border: "none",
        borderRadius: 2,
        minHeight: 52,
        padding: "12px 18px",
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontFamily: MONO_FONT_STACK,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        width: "100%",
        transform: pressed ? "scale(0.985)" : "scale(1)",
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
  const { t, en } = useLang();
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
  const entries = bodycomp || [];
  const latestDate = entries.reduce((max, item) => String(item?.date || "") > max ? String(item.date) : max, "");
  // New body entries are prepended, so the first entry on the latest date is the newest same-day value.
  const latest = latestDate ? entries.find((item) => String(item?.date || "") === latestDate) : null;
  return {
    latest,
    weight: latest?.weight ?? settings.startWeight ?? null,
    bodyfat: latest?.bodyfat ?? settings.startBF ?? null,
  };
}

function MiniMetric({ label, value, sub, color, icon, onClick, spark = false }) {
  const theme = useTheme();
  const c = color || theme.ring;
  const content = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
        <span style={{ color: theme.textFaint, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: MONO_FONT_STACK }}>{label}</span>
        {icon && <span style={{ color: c, display: "grid", placeItems: "center", opacity: 0.9 }}>{icon}</span>}
      </div>
      <div style={{ color: theme.text, fontSize: 26, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{value}</div>
      {sub && <div style={{ color: theme.textFaint, fontSize: 10.5, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO_FONT_STACK, letterSpacing: "0.04em", textTransform: "uppercase" }}>{sub}</div>}
      {spark && <MiniBarSpark color={c} />}
    </>
  );
  const common = { flex: 1, minWidth: 0, background: "transparent", borderTop: `1px solid ${theme.border}`, paddingTop: 11, boxSizing: "border-box" };
  if (onClick) {
    return <button onClick={onClick} style={{ ...common, textAlign: "left", cursor: "pointer", border: "none", borderTop: `1px solid ${theme.border}`, color: theme.text }}>{content}</button>;
  }
  return <div style={common}>{content}</div>;
}

function IntentCard({ title, body, color, icon, onClick }) {
  const theme = useTheme();
  return (
    <button onClick={onClick} style={{ width: "100%", border: "none", borderTop: `1px solid ${theme.border}`, background: "transparent", padding: "16px 2px", textAlign: "left", cursor: "pointer", color: theme.text, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 500, fontStyle: "italic", letterSpacing: "-0.01em", lineHeight: 1, fontFamily: SERIF_FONT_STACK, color: theme.text }}>{title}</div>
        <div style={{ fontSize: 12, color: theme.textDim, lineHeight: 1.35 }}>{body}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ color: theme.textFaint }}>{icon}</span>
        <ChevronRight size={16} color={theme.textFaint} />
      </div>
    </button>
  );
}

function TodayTab({ settings, bodycomp, recentAvgSteps, currentSteps, goToTab, openActView, workouts, nutrition, dayLogs, setDayLogs, weekPlan, programs }) {
  const { t, en } = useLang();
  const theme = useTheme();
  const { weight, bodyfat } = getLatestBodyComp(bodycomp, settings);
  const engine = estimateTdeeEngine(settings, bodycomp, nutrition, workouts, weight, recentAvgSteps);
  const effectiveTdee = targetTdee(settings, engine);
  const baseActiveTarget = effectiveTdee ? computeActiveTarget(settings, effectiveTdee, weight, bodyfat, engine?.bmr) : null;
  const activeTarget = applyCheatDayTarget(settings, baseActiveTarget, effectiveTdee, engine?.bmr);
  const target = activeTarget?.target ?? null;
  const goalLabel = settings.goalMode === "gain" ? t("증량", "Gain") : settings.goalMode === "maintain" ? t("유지", "Maintain") : t("감량", "Cut");
  const [stepsOpen, setStepsOpen] = useState(false);
  const stepsValue = currentSteps != null ? Math.round(currentSteps).toLocaleString() : "—";
  const avgStepsLabel = recentAvgSteps != null ? Math.round(recentAvgSteps).toLocaleString() : t("데이터 없음", "No data yet");

  const today = todayStr();
  const todayLog = dayLogs.find((d) => d.date === today);
  const loggedWorkout = workouts.some((w) => w.date === today);
  const loggedMeal = nutrition.some((n) => n.date === today);
  const loggedCheckin = hasCheckinData(todayLog);
  const restCompleted = hasRestCredit(todayLog);
  const mealsToday = nutrition.filter((n) => n.date === today);
  const mealGroupsToday = mealCategoryCount(mealsToday);
  const calsToday = mealsToday.reduce((s, n) => s + (+n.calories || 0), 0);
  const remaining = target != null ? Math.round(target - calsToday) : null;

  const consistencyStreak = useMemo(
    () => calcConsistencyStreak(weekPlan, workouts, dayLogs, programs),
    [weekPlan, workouts, dayLogs, programs]
  );
  const workoutStreak = useMemo(
    () => calcWorkoutStreak(workouts),
    [workouts]
  );

  // next planned workout from this week's plan
  const nextWorkout = useMemo(() => {
    if (!weekPlan?.length) return null;
    const dow = (nowDate().getDay() + 6) % 7; // Mon=0
    for (let i = 0; i < 7; i++) {
      const d = weekPlan[(dow + i) % 7];
      if (d && d.kind !== "rest") {
        const label = d.kind === "lift" ? (programs?.find((p) => p.id === d.programId)?.name || "Lift") : (d.runLabel === "L.R" ? "Long Run" : d.runLabel === "S.R" ? "Short Run" : "Run");
        return i === 0 ? label : label;
      }
    }
    return "Rest";
  }, [weekPlan, programs]);

  // today's planned session (mirrors ActTab) for the home session block
  const todayIdx = (nowDate().getDay() + 6) % 7; // Mon=0
  const todayPlan = weekPlan?.[todayIdx];
  const todayProgram = todayPlan?.kind === "lift" ? (programs?.find((p) => p.id === todayPlan.programId) || null) : null;
  const todayIsRun = todayPlan?.kind === "run";
  const sessionLabel = todayProgram ? todayProgram.name : todayIsRun ? (todayPlan.runLabel === "L.R" ? "Long Run" : todayPlan.runLabel === "S.R" ? "Short Run" : "Run") : t("휴식", "Rest");
  const sessionExCount = todayProgram?.exercises?.length || 0;
  const isRestDay = !todayProgram && !todayIsRun;
  const plannedSessionComplete = workouts.some((w) => {
    if (w.date !== today) return false;
    if (todayProgram) return w.type === "lift" && (w.programId === todayProgram.id || w.subtype === todayProgram.name);
    if (todayIsRun) return w.type === "run" && (!todayPlan.runLabel || w.subtype === todayPlan.runLabel);
    return false;
  });
  const completeRestDay = () => {
    const entry = {
      ...(todayLog || {}),
      id: todayLog?.id || uid(),
      date: today,
      restCompleted: true,
      restCompletedAt: new Date().toISOString(),
    };
    setDayLogs([entry, ...dayLogs.filter((d) => d.date !== today)]);
  };
  const statusItems = [
    isRestDay
      ? { done: restCompleted, label: restCompleted ? t("휴식 완료 · consistency 유지", "Rest complete · consistency kept") : t("휴식 완료 필요", "Rest confirmation needed"), action: completeRestDay }
      : { done: plannedSessionComplete, label: plannedSessionComplete ? t("오늘 운동 완료", "Workout complete") : t("오늘 운동 기록", "Workout pending"), action: () => openActView(todayIsRun ? "cardio" : "training") },
    { done: loggedMeal, label: loggedMeal ? t(`오늘 ${mealGroupsToday}끼 · 아이템 ${mealsToday.length}개 · ${Math.round(calsToday)}kcal`, `${mealGroupsToday} meals · ${mealsToday.length} items · ${Math.round(calsToday)}kcal`) : t("아직 식사 기록 없음", "No meals logged"), action: () => goToTab("eat") },
    { done: loggedCheckin, label: loggedCheckin ? t("오늘 체크인 완료", "Check-in complete") : t("체크인 미완료", "Check-in pending"), action: () => openActView("checkin") },
  ];

  const cells = [
    { label: "WEIGHT", value: weight ? `${Number(weight).toFixed(1)}` : "—", unit: weight ? "kg" : "", onClick: () => openActView("body") },
    { label: "CONSIST", value: consistencyStreak > 0 ? `${consistencyStreak}` : "—", unit: consistencyStreak > 0 ? "d" : "", onClick: () => openActView(isRestDay ? "checkin" : "training") },
    { label: "WORKOUT", value: workoutStreak > 0 ? `${workoutStreak}` : "—", unit: workoutStreak > 0 ? "d" : "", onClick: () => openActView("training") },
  ];
  const stepSuccessColor = "#46A89A";

  // steps progress
  const STEPS_GOAL = 10000;
  const stepsNum = currentSteps != null ? Math.round(currentSteps) : null;
  const stepGoalHit = stepsNum != null && stepsNum >= STEPS_GOAL;
  const stepsPct = stepsNum != null ? Math.min(100, (stepsNum / STEPS_GOAL) * 100) : 0;
  const calPct = target ? Math.min(100, (calsToday / Math.max(1, target)) * 100) : 0;

  return (
    <div className="today-compact" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0, boxSizing: "border-box", justifyContent: "space-between" }}> 
      {stepsOpen && (
        <ConfirmDialog
          message={t(`오늘 걸음수: ${stepsValue}보\n최근 7일 평균: ${avgStepsLabel}보`, `Today's steps: ${stepsValue}\nRecent 7-day average: ${avgStepsLabel}`)}
          onConfirm={() => setStepsOpen(false)}
          onCancel={() => setStepsOpen(false)}
          confirmLabel={t("확인", "OK")}
          hideCancel
          tone="neutral"
        />
      )}
      <div className="today-header">
        <ScreenHeader
          eyebrow="Today"
          title="Today"
          subtitle={t("오늘 상태를 확인하고 바로 기록하세요.", "Check today, then log what matters.")}
        />
      </div>

      {/* TWO PRIMARY METERS — calories & steps, equal weight */}
      <div className="today-meters" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <button onClick={() => goToTab("eat")} style={{ width: "100%", background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: theme.text }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
            <span style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint }}>
              {target != null ? (remaining >= 0 ? en("남은 칼로리", "Calories Left") : en("초과 칼로리", "Calories Over")) : en("칼로리", "Calories")}
            </span>
            <span style={{ fontSize: 11, fontFamily: MONO_FONT_STACK, color: theme.textFaint, letterSpacing: "0.04em" }}>
              {target != null ? `${Math.round(calsToday).toLocaleString()} / ${Math.round(target).toLocaleString()}` : "—"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
            <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 0.9, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", color: target != null && remaining < 0 ? theme.danger : theme.text }}>
              {target != null ? Math.abs(remaining).toLocaleString() : "—"}
            </span>
            <span style={{ fontSize: 12, color: theme.textDim, fontFamily: MONO_FONT_STACK }}>kcal</span>
          </div>
          <ProgressLine value={calPct} color={theme.lift} />
        </button>

        {!WEB_BUILD && (
        <button onClick={() => setStepsOpen(true)} style={{ width: "100%", background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: theme.text }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
            <span style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint }}>{en("걸음", "Steps")}</span>
            <span style={{ fontSize: 11, fontFamily: MONO_FONT_STACK, color: theme.textFaint, letterSpacing: "0.04em" }}>
              {stepsNum != null ? `${stepsNum.toLocaleString()} / ${STEPS_GOAL.toLocaleString()}` : "—"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
            <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 0.9, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", color: stepGoalHit ? stepSuccessColor : theme.text }}>
              {stepsNum != null ? stepsNum.toLocaleString() : "—"}
            </span>
            <span style={{ fontSize: 12, color: theme.textDim, fontFamily: MONO_FONT_STACK }}>{en("걸음", "steps")}</span>
          </div>
          <ProgressLine value={stepsPct} color={stepGoalHit ? stepSuccessColor : theme.text} />
        </button>
        )}
      </div>

      {/* TODAY'S SESSION — action block */}
      <div className="today-session">
        <div style={{ fontSize: 11, fontFamily: MONO_FONT_STACK, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.textDim, marginBottom: 10 }}>{isRestDay ? en("오늘 회복", "Today's Recovery") : en("오늘 세션", "Today's Session")}</div>
        {plannedSessionComplete ? (
          <div style={{ borderTop: `1px solid ${stepSuccessColor}`, borderBottom: `1px solid ${stepSuccessColor}`, padding: "14px 2px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 999, background: tint(stepSuccessColor,.15), display: "grid", placeItems: "center" }}><Check size={20} color={stepSuccessColor}/></div>
            <div><div style={{ fontSize: 18, fontFamily: SERIF_FONT_STACK, fontStyle: "italic", color: theme.text }}>{t("오늘의 세션을 완료했습니다", "Nice work — today's session is complete.")}</div><div style={{ fontSize: 10.5, color: stepSuccessColor, fontFamily: MONO_FONT_STACK, marginTop: 4 }}>SESSION COMPLETE</div></div>
          </div>
        ) : isRestDay ? (
          restCompleted ? (
            <div style={{ borderTop: `1px solid ${stepSuccessColor}`, borderBottom: `1px solid ${stepSuccessColor}`, padding: "14px 2px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 999, background: tint(stepSuccessColor,.15), display: "grid", placeItems: "center" }}><Check size={20} color={stepSuccessColor}/></div>
              <div>
                <div style={{ fontSize: 18, fontFamily: SERIF_FONT_STACK, fontStyle: "italic", color: theme.text }}>{t("휴식 완료", "Recovery complete.")}</div>
                <div style={{ fontSize: 10.5, color: stepSuccessColor, fontFamily: MONO_FONT_STACK, marginTop: 4 }}>CONSISTENCY KEPT</div>
              </div>
            </div>
          ) : (
            <div style={{ borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, padding: "16px 2px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: MONO_FONT_STACK, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.textDim, marginBottom: 8 }}>{en("오늘 회복", "Today's Recovery")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><BedDouble size={18} color={theme.textDim}/><div style={{ fontSize: 20, fontWeight: 500, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, color: theme.textDim }}>{t("휴식일", "Rest Day")}</div></div>
                <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase", color: theme.textFaint, marginTop: 6 }}>{en("휴식 완료 시 consistency 유지", "Confirm rest to keep consistency")}</div>
              </div>
              <button onClick={completeRestDay} style={{ background: theme.lift, border: "none", borderRadius: 2, padding: "10px 14px", cursor: "pointer", color: "#0A0A0A", fontFamily: MONO_FONT_STACK, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>{en("휴식 완료", "Done")}</button>
            </div>
          )
        ) : (
          <button onClick={() => openActView(todayIsRun ? "cardio" : "training")} style={{
            width: "100%", textAlign: "left", cursor: "pointer",
            background: theme.lift, border: "none", borderRadius: 2, padding: "16px 18px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, color: "#0A0A0A", lineHeight: 1 }}>{sessionLabel}</div>
              <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(10,10,10,0.62)", marginTop: 6 }}>
                {todayIsRun ? en("유산소 세션", "Cardio Session") : `${sessionExCount} ${en("개 운동", "Exercises")}`}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(10,10,10,0.14)", borderRadius: 2, padding: "10px 14px", flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO_FONT_STACK, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A0A0A" }}>{en("시작", "Start")}</span>
              <ChevronRight size={15} color="#0A0A0A" strokeWidth={2.5} />
            </div>
          </button>
        )}
      </div>

      {/* INDICATOR STRIP — weight / streak / next (steps promoted above) */}
      <div className="today-indicators">
        <RuleLine />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
          {cells.map((c, i) => (
            <button key={c.label} onClick={c.onClick} style={{
              background: "none", border: "none", cursor: "pointer", textAlign: "left",
              padding: "13px 10px 13px 0", borderRight: i < 2 ? `1px solid ${theme.border}` : "none",
              paddingLeft: i === 0 ? 0 : 12,
            }}>
              <div style={{ fontSize: 9, fontFamily: MONO_FONT_STACK, letterSpacing: "0.14em", color: theme.textFaint, marginBottom: 7 }}>{c.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                <span style={{ fontSize: c.small ? 13 : 19, fontWeight: c.small ? 600 : 800, color: theme.text, fontVariantNumeric: "tabular-nums", lineHeight: 1, letterSpacing: c.small ? "0" : "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{c.value}</span>
                {c.unit && <span style={{ fontSize: 10, color: theme.textDim }}>{c.unit}</span>}
              </div>
            </button>
          ))}
        </div>
        <RuleLine />
      </div>

      {/* TODAY'S CHECKLIST — rule-line list */}
      <div className="today-checklist">
        <div style={{ fontSize: 11, fontFamily: MONO_FONT_STACK, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.textDim, marginBottom: 4 }}>{en("오늘 체크리스트", "Today's Log")}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {statusItems.map((item, i) => (
            <button key={i} onClick={item.action} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
              padding: "13px 0", borderTop: `1px solid ${theme.border}`,
              background: "none", border: "none", cursor: "pointer", textAlign: "left",
              borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: theme.border,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 2, flexShrink: 0,
                  background: item.done ? theme.lift : "transparent",
                  border: `1.5px solid ${item.done ? theme.lift : theme.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {item.done && <Check size={10} color="#0A0A0A" strokeWidth={3} />}
                </div>
                <span style={{ fontSize: 13, color: item.done ? theme.text : theme.textDim }}>{item.label}</span>
              </div>
              <span style={{ fontSize: 9.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", color: item.done ? theme.lift : theme.textFaint }}>{item.done ? "LOGGED" : "PENDING"}</span>
            </button>
          ))}
        </div>
        <RuleLine />
      </div>
    </div>
  );
}

function ActionTile({ title, body, icon, color, onClick }) {
  const theme = useTheme();
  return (
    <button onClick={onClick} style={{ border: "none", borderTop: `1px solid ${theme.border}`, background: "transparent", padding: "16px 2px", minHeight: 92, cursor: "pointer", color: theme.text, textAlign: "left", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: theme.textFaint }}>{icon}</span>
        <ChevronRight size={16} color={theme.textFaint} />
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 500, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, letterSpacing: "-0.01em", color: theme.text }}>{title}</div>
        <div style={{ fontSize: 11, color: theme.textDim, marginTop: 5, lineHeight: 1.4 }}>{body}</div>
      </div>
    </button>
  );
}

function ActTab({ isActive = true, workouts, setWorkouts, programs, weekPlan, bodycomp, setBodycomp, dayLogs, setDayLogs, initialView, onConsumedInitialView, resetSignal, onViewChange, currentSteps }) {
  const { t, en } = useLang();
  const theme = useTheme();
  const [view, setView] = useState("overview");
  const [editWorkoutId, setEditWorkoutId] = useState(null);
  const [editWorkoutSignal, setEditWorkoutSignal] = useState(0);
  const [showAllDayLogs, setShowAllDayLogs] = useState(false);

  const openView = (next) => {
    // Recent Activity can open an edit modal directly from the Act overview.
    // Once the user navigates into a real Act sub-screen, clear that direct-edit
    // request so the new WorkoutsTab instance does not consume a stale edit id.
    if (next && next !== "overview") {
      setEditWorkoutId(null);
      setEditWorkoutSignal((v) => v + 1);
      try { window.history.pushState({ hlActView: next }, "", window.location.href); } catch (e) { /* ignore */ }
    }
    setView(next || "overview");
  };
  const closeView = () => {
    setEditWorkoutId(null);
    setEditWorkoutSignal((v) => v + 1);
    setView("overview");
  };
  const openWorkoutEdit = (entry) => {
    setEditWorkoutId(entry.id);
    setEditWorkoutSignal((v) => v + 1);
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

  // Resolve today's plan before rendering a subview so the training screen can open the correct program.
  const todayIdx = (nowDate().getDay() + 6) % 7;
  const todayPlan = weekPlan?.[todayIdx];
  const todayProgram = todayPlan?.kind === "lift" ? (programs?.find((p) => p.id === todayPlan.programId) || null) : null;
  const todayIsRun = todayPlan?.kind === "run";

  const BackBtn = () => <button onClick={closeView} style={{ alignSelf: "flex-start", background: "transparent", border: "none", color: theme.ring, fontSize: 13, fontWeight: 700 }}>← {t("Act", "Act")}</button>;
  if (view === "training") return <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "hlViewIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)" }}><BackBtn /><WorkoutsTab isActive={isActive} workouts={workouts} setWorkouts={setWorkouts} programs={programs} initialProgramId={todayProgram?.id || null} initialEditId={editWorkoutId} editSignal={editWorkoutSignal} /></div>;
  if (view === "cardio") return <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "hlViewIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)" }}><BackBtn /><WorkoutsTab isActive={isActive} workouts={workouts} setWorkouts={setWorkouts} programs={programs} initialMode="run" initialEditId={editWorkoutId} editSignal={editWorkoutSignal} /></div>;
  if (view === "body") return <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "hlViewIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)" }}><BackBtn /><BodyCompTab bodycomp={bodycomp} setBodycomp={setBodycomp} /></div>;
  if (view === "checkin") return <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "hlViewIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)" }}><BackBtn /><DayLogCard dayLogs={dayLogs} setDayLogs={setDayLogs} /></div>;
  const recentActivities = [...workouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const sortedDayLogs = [...dayLogs].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const visibleDayLogs = showAllDayLogs ? sortedDayLogs : sortedDayLogs.slice(0, 4);
  const directEditWorkout = editWorkoutId ? workouts.find((w) => w.id === editWorkoutId) : null;

  const todayLabel = todayProgram ? todayProgram.name : todayIsRun ? (todayPlan.runLabel === "L.R" ? "Long Run" : todayPlan.runLabel === "S.R" ? "Short Run" : "Run") : t("휴식", "Rest");
  const todayExCount = todayProgram?.exercises?.length || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <WorkoutsTab
        isActive={isActive && view === "overview"}
        modalOnly
        workouts={workouts}
        setWorkouts={setWorkouts}
        programs={programs}
        initialMode={directEditWorkout?.type === "run" ? "run" : undefined}
        initialProgramId={directEditWorkout?.programId || todayProgram?.id || null}
        initialEditId={editWorkoutId}
        editSignal={editWorkoutSignal}
      />
      <ScreenHeader
        eyebrow="Activity"
        title="Act"
        subtitle={t("운동, 활동, 체성분, 체크인을 한 곳에서 기록합니다.", "Log training, activity, body and check-ins.")}
      />
      {/* ACTION ZONE — today's session as the prominent entry */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint, marginBottom: 10 }}>
          {en("오늘 세션", "Today's Session")}
        </div>
        <button onClick={() => openView(todayIsRun ? "cardio" : "training")} style={{
          width: "100%", textAlign: "left", cursor: "pointer",
          background: theme.lift, border: "none", borderRadius: 2, padding: "16px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, color: "#0A0A0A", lineHeight: 1 }}>{todayLabel}</div>
            <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(10,10,10,0.62)", marginTop: 6 }}>
              {todayIsRun ? en("유산소", "Cardio") : todayProgram ? `${todayExCount} ${en("개 운동", "Exercises")}` : en("휴식일 · 자유 운동", "Rest day · free log")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(10,10,10,0.14)", borderRadius: 2, padding: "10px 14px", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO_FONT_STACK, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A0A0A" }}>{en("시작", "Start")}</span>
            <ChevronRight size={15} color="#0A0A0A" strokeWidth={2.5} />
          </div>
        </button>

        {/* secondary actions — compact row, demoted below the primary CTA */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
          {[
            { label: en("유산소", "Cardio"), icon: <Activity size={16} />, go: "cardio" },
            { label: en("신체", "Body"), icon: <Scale size={16} />, go: "body" },
            { label: en("체크인", "Check-in"), icon: <Smile size={16} />, go: "checkin" },
          ].map((a) => (
            <button key={a.go} onClick={() => openView(a.go)} style={{
              background: "transparent", border: `1px solid ${theme.border}`, borderRadius: 2,
              padding: "12px 8px", cursor: "pointer", color: theme.textDim,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
            }}>
              {a.icon}
              <span style={{ fontSize: 9.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase" }}>{a.label}</span>
            </button>
          ))}
        </div>

        {/* Android-only steps — hidden in the GitHub Pages/web build */}
        {!WEB_BUILD && (
        <div style={{ marginTop: 16 }}>
          <RuleLine />
          <button onClick={() => openView("body")} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "13px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, fontFamily: MONO_FONT_STACK, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.textFaint }}>{en("걸음", "Steps")}</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 19, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums" }}>{currentSteps != null ? Math.round(currentSteps).toLocaleString() : "—"}</span>
              <span style={{ fontSize: 10, color: theme.textFaint, fontFamily: MONO_FONT_STACK }}>/ 10,000</span>
            </span>
          </button>
          <RuleLine />
        </div>
        )}
      </div>
      {/* LOG ZONE — recent activity as a training logbook (rule lines) */}
      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint, marginBottom: 4 }}>
          {en("최근 활동", "Recent Activity")}
        </div>
        {recentActivities.length ? (
          <div>
            {recentActivities.map((w, i) => {
              const isLift = w.type === "lift";
              // derive a compact right-hand metric: volume for lifts, distance/time for runs
              let metric = "";
              if (isLift && Array.isArray(w.exercises)) {
                const vol = w.exercises.reduce((s, ex) => s + (ex.sets || []).reduce((ss, st) => ss + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0), 0);
                const setCount = w.exercises.reduce((s, ex) => s + (ex.sets?.length || 0), 0);
                metric = vol > 0 ? `${setCount} ${en("세트", "sets")} · ${Math.round(vol).toLocaleString()}kg` : `${setCount} ${en("세트", "sets")}`;
              } else if (!isLift) {
                metric = [w.distanceKm ? `${w.distanceKm}km` : null, w.durationMin ? `${w.durationMin}min` : null].filter(Boolean).join(" · ");
              }
              return (
                <button key={w.id} onClick={() => openWorkoutEdit(w)} style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "13px 0", borderTop: `1px solid ${theme.border}`,
                  background: "none", border: "none", borderTop: `1px solid ${theme.border}`, cursor: "pointer", textAlign: "left",
                  ...staggerStyle(i),
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, color: theme.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.subtype || (isLift ? "Lift" : "Run")}</span>
                    <span style={{ fontSize: 10, fontFamily: MONO_FONT_STACK, letterSpacing: "0.06em", color: theme.textFaint, whiteSpace: "nowrap" }}>{fmtDate(w.date)}</span>
                  </div>
                  <span style={{ fontSize: 11, fontFamily: MONO_FONT_STACK, color: theme.textDim, letterSpacing: "0.04em", whiteSpace: "nowrap", flexShrink: 0, marginLeft: 10 }}>{metric || (isLift ? en("리프팅", "LIFT") : en("유산소", "CARDIO"))}</span>
                </button>
              );
            })}
            <RuleLine />
          </div>
        ) : (
          <div><RuleLine /><EmptyState icon={Activity} text={t("아직 활동 기록이 없어요.", "No activity logged yet.")} /><RuleLine /></div>
        )}
      </div>

      {/* DAILY LOG — demoted, collapsible */}
      <div style={{ marginTop: 20 }}>
        <button onClick={() => setShowAllDayLogs(!showAllDayLogs)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", padding: "0 0 4px" }}>
          <span style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint }}>{en("데일리 로그", "Daily Log")}</span>
          <span style={{ fontSize: 10, fontFamily: MONO_FONT_STACK, color: theme.textFaint, display: "flex", alignItems: "center", gap: 4 }}>
            {sortedDayLogs.length > 0 ? (showAllDayLogs ? en("접기", "Less") : en("펼치기", "More")) : ""}
            {sortedDayLogs.length > 0 && (showAllDayLogs ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
          </span>
        </button>
        {sortedDayLogs.length ? (
          <div>
            {(showAllDayLogs ? sortedDayLogs.slice(0, 10) : sortedDayLogs.slice(0, 2)).map((d) => (
              <button key={d.id} onClick={() => openView("checkin")} style={{ width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${theme.border}`, padding: "12px 0", color: theme.text, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, fontStyle: "italic", fontFamily: SERIF_FONT_STACK }}>{fmtDate(d.date)}</span>
                  <span style={{ fontSize: 10.5, color: theme.textDim, fontFamily: MONO_FONT_STACK, letterSpacing: "0.04em" }}>
                    {d.restCompleted ? "REST · " : ""}{en("기분", "M")}{d.mood || "—"} · {en("에너지", "E")}{d.energy || "—"} · {en("수면", "S")}{d.sleep || "—"}
                  </span>
                </div>
                {d.note && <div style={{ fontSize: 12, color: theme.textFaint, lineHeight: 1.4, marginTop: 4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>{d.note}</div>}
              </button>
            ))}
            <RuleLine />
          </div>
        ) : (
          <div><RuleLine /><button onClick={() => openView("checkin")} style={{ width: "100%", padding: "16px 0", textAlign: "center", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: theme.lift, fontFamily: MONO_FONT_STACK, letterSpacing: "0.08em", textTransform: "uppercase" }}>{en("체크인 작성", "Write check-in")}</button><RuleLine /></div>
        )}
      </div>

      {workouts.length > 0 && <div style={{ marginTop: 16 }}><MuscleGroupBreakdown workouts={workouts} /></div>}
    </div>
  );
}

function PlanTab({ settings, onSaveSettings, bodycomp, nutrition, workouts, programs, weekPlan, setWeekPlan, setPrograms, recentAvgSteps, tdeeHistory, setTdeeHistory, resetSignal }) {
  const { lang, t, en } = useLang();
  const theme = useTheme();
  const { weight, bodyfat } = getLatestBodyComp(bodycomp, settings);
  const engine = estimateTdeeEngine(settings, bodycomp, nutrition, workouts, weight, recentAvgSteps);
  const effectiveTdee = targetTdee(settings, engine);
  const roundedTdee = effectiveTdee ? Math.round(effectiveTdee / 10) * 10 : null;
  const GoalButton = ({ mode, label }) => {
    const activeMode = settings.goalMode === mode;
    return <button onClick={() => onSaveSettings({ ...settings, goalMode: mode })} style={{ flex: 1, minHeight: 48, borderRadius: 2, border: `1px solid ${activeMode ? theme.lift : theme.border}`, background: activeMode ? theme.lift : "transparent", color: activeMode ? (theme.heroText || "#0A0A0A") : theme.text, fontWeight: 700 }}>{label}</button>;
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ScreenHeader
        eyebrow="Strategy"
        title="Plan"
        subtitle={t("목표, 칼로리, 운동 계획, 주간 타깃을 조정합니다.", "Set goals, calories, training and weekly targets.")}
      />

      {/* WEEKLY GRID — the hero of this tab */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint }}>{en("주간 계획", "This Week")}</span>
          <span style={{ fontSize: 10, fontFamily: MONO_FONT_STACK, letterSpacing: "0.06em", color: theme.textFaint }}>{en("요일 탭해서 수정", "Tap to edit")}</span>
        </div>
        <div style={{ display: "flex", gap: 5, justifyContent: "space-between" }}>
          {weekPlan.map((d, i) => {
            const isToday = i === todayIdx;
            const done = doneMap[i];
            const isRest = d.kind === "rest";
            const label = d.kind === "lift" ? (programs.find((p) => p.id === d.programId)?.name || "?") : d.kind === "run" ? (d.runLabel === "S.R" ? "Short" : d.runLabel === "L.R" ? "Long" : (d.runLabel || "Run")) : "Rest";
            const active = editingDayIdx === i;
            return (
              <button key={i} onClick={() => setEditingDayIdx(editingDayIdx === i ? null : i)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
                <div style={{ fontSize: 9.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.08em", color: isToday ? theme.lift : theme.textFaint, fontWeight: isToday ? 700 : 500 }}>{["MON","TUE","WED","THU","FRI","SAT","SUN"][i]}</div>
                <div style={{
                  width: "100%", aspectRatio: "1", borderRadius: 2,
                  background: done ? theme.lift : (active ? theme.surfaceRaised : "transparent"),
                  border: `1px solid ${active ? theme.lift : (isToday ? theme.lift : theme.border)}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {done ? <Check size={14} color="#0A0A0A" strokeWidth={3} /> : (d.kind === "lift" ? <Dumbbell size={13} color={isToday ? theme.lift : theme.textDim} /> : d.kind === "run" ? <Activity size={13} color={isToday ? theme.lift : theme.textDim} /> : <span style={{ fontSize: 9, color: theme.textFaint, fontFamily: MONO_FONT_STACK }}>—</span>)}
                </div>
                <div style={{ fontSize: 8.5, color: isToday ? theme.text : theme.textFaint, textAlign: "center", fontFamily: MONO_FONT_STACK, letterSpacing: "0.02em", lineHeight: 1.1, height: 20, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "100%" }}>{isRest ? "" : label.slice(0, 6)}</div>
              </button>
            );
          })}
        </div>
      </div>
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

      {/* GOAL — compact spec row */}
      <div>
        <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint, marginBottom: 10 }}>{en("목표", "Goal")}</div>
        <div style={{ display: "flex", gap: 8 }}><GoalButton mode="cut" label={t("감량", "Cut")} /><GoalButton mode="maintain" label={t("유지", "Maintain")} /><GoalButton mode="gain" label={t("증량", "Gain")} /></div>
      </div>

      {/* CALORIE STRATEGY */}
      <div>
        <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint, marginBottom: 10 }}>{en("칼로리 전략", "Calorie Strategy")}</div>
        {roundedTdee && weight ? (
          <GoalTargetsPanel
            settings={settings}
            onSaveSettings={onSaveSettings}
            effectiveTdee={roundedTdee}
            currentWeight={weight}
            currentBF={bodyfat}
            weekPlan={weekPlan}
            bmr={engine?.bmr}
          />
        ) : (
          <div><RuleLine /><div style={{ padding: "16px 0", fontSize: 12.5, color: theme.textFaint }}>{t("신체 정보가 충분하면 목표 칼로리가 표시됩니다.", "Add body data to show a calorie target.")}</div><RuleLine /></div>
        )}
      </div>

      {/* WEEKLY TARGETS — spec table */}
      <div>
        <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint, marginBottom: 4 }}>{en("주간 타깃", "Weekly Targets")}</div>
        {[
          { label: en("운동", "Workouts"), value: `${weekPlan.filter(d=>d.kind!=="rest").length} / 7` },
          { label: en("단백질", "Protein"), value: roundedTdee ? `${macrosFor(roundedTdee, weight, settings.sex, bodyfat, settings.carbPercent).proteinG}g` : "—" },
          { label: en("활동", "Activity"), value: (ACTIVITY_LEVELS.find((a) => a.id === settings.activity) || ACTIVITY_LEVELS[1]).label(t) },
        ].map((row) => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderTop: `1px solid ${theme.border}` }}>
            <span style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase", color: theme.textDim }}>{row.label}</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
          </div>
        ))}
        <RuleLine />
      </div>

      {/* HEALTH CONTEXT — demoted, at the bottom */}
      <div>
        <button onClick={() => setShowHealthContext(!showHealthContext)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", padding: "2px 0 10px" }}>
          <span style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: healthActive ? theme.danger : theme.textFaint }}>{en("건강 예외", "Health Context")}</span>
          <span style={{ fontSize: 10, fontFamily: MONO_FONT_STACK, color: healthActive ? theme.danger : theme.textFaint, display: "flex", alignItems: "center", gap: 5 }}>
            {healthActive ? en("적용 중", "ACTIVE") : en("꺼짐", "OFF")}
            {showHealthContext ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>
        {showHealthContext && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, paddingTop: 4 }}>
            <button onClick={() => onSaveSettings({ ...settings, pregnantOrBreastfeeding: !settings.pregnantOrBreastfeeding })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 0", borderTop: `1px solid ${theme.border}`, background: "none", border: "none", borderTop: `1px solid ${theme.border}`, color: theme.text, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 13 }}>{t("임신/수유 중", "Pregnant or breastfeeding")}</span>
              <span style={{ width: 20, height: 20, borderRadius: 2, border: `2px solid ${settings.pregnantOrBreastfeeding ? theme.danger : theme.border}`, background: settings.pregnantOrBreastfeeding ? theme.danger : "transparent", display: "grid", placeItems: "center", flexShrink: 0 }}>{settings.pregnantOrBreastfeeding && <Check size={12} color="#fff" />}</span>
            </button>
            <button onClick={() => onSaveSettings({ ...settings, edRecoveryOrClinical: !settings.edRecoveryOrClinical })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 0", borderTop: `1px solid ${theme.border}`, background: "none", border: "none", borderTop: `1px solid ${theme.border}`, color: theme.text, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 13 }}>{t("식이장애 회복/임상 관리 중", "ED recovery or clinical supervision")}</span>
              <span style={{ width: 20, height: 20, borderRadius: 2, border: `2px solid ${settings.edRecoveryOrClinical ? theme.danger : theme.border}`, background: settings.edRecoveryOrClinical ? theme.danger : "transparent", display: "grid", placeItems: "center", flexShrink: 0 }}>{settings.edRecoveryOrClinical && <Check size={12} color="#fff" />}</span>
            </button>
          </div>
        )}
      </div>
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


function PatchNotesStartupModal({ open, onDismiss, onOpenNotes }) {
  const theme = useTheme();
  const { t } = useLang();
  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Patch notes"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: tint("#000000", 0.42),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "88vh",
          overflowY: "auto",
          background: theme.bg,
          color: theme.text,
          border: `1px solid ${theme.border}`,
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.38)",
          padding: "22px 20px calc(20px + env(safe-area-inset-bottom))",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: MONO_FONT_STACK, color: theme.lift, fontWeight: 800, marginBottom: 8 }}>
          Hybrid Log {BUILD_RELEASE}
        </div>
        <div style={{ fontSize: 24, lineHeight: 1.1, fontWeight: 650, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, color: theme.text, marginBottom: 8 }}>
          {t("업데이트 패치노트", "Update Patch Notes")}
        </div>
        <div style={{ fontSize: 13, color: theme.textDim, lineHeight: 1.55, marginBottom: 18 }}>
          {t("이번 웹 버전은 GitHub Pages, 바탕화면 아이콘, 패치노트 표시 방식을 정리한 안정화 패치입니다.", "This web release stabilises GitHub Pages deployment, desktop shortcuts, and patch-note visibility.")}
        </div>

        <div style={{ display: "grid", gap: 11, marginBottom: 18 }}>
          {[
            t("앱 시작 시 이 패치노트를 1회 자동 표시합니다.", "Shows this patch note once on app launch."),
            t("확인 후에는 같은 버전에서 다시 자동으로 뜨지 않습니다.", "After confirmation, it will not auto-open again for this version."),
            t("바탕화면 아이콘 오류 방지를 위해 기존 shortcut은 삭제 후 다시 만들어야 합니다.", "To avoid desktop shortcut errors, delete the old shortcut and create it again."),
            t("패치노트는 설정 화면에서도 다시 열 수 있습니다.", "Patch notes can still be opened again from Settings."),
          ].map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: tint(theme.lift, 0.15), color: theme.lift, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 850, fontFamily: MONO_FONT_STACK, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ fontSize: 13, lineHeight: 1.45, color: theme.text }}>{line}</div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 14, display: "grid", gap: 10 }}>
          <PrimaryButton onClick={onDismiss}>
            {t("확인함", "Got it")}
          </PrimaryButton>
          <button
            onClick={onOpenNotes}
            style={{
              width: "100%",
              minHeight: 46,
              borderRadius: 2,
              border: `1px solid ${theme.border}`,
              background: "transparent",
              color: theme.textDim,
              fontSize: 12,
              fontWeight: 750,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontFamily: MONO_FONT_STACK,
              cursor: "pointer",
            }}
          >
            {t("전체 패치노트 열기", "Open Full Patch Notes")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


// Shared step-count achievement tiers.
const STEP_TIERS = [
  { id: "low", threshold: 4000, label: (t) => t("적음", "Low") },
  { id: "moderate", threshold: 8000, label: (t) => t("보통", "Moderate") },
  { id: "high", threshold: 12000, label: (t) => t("많음", "High") },
];

function StepAchievementBar({ steps }) {
  const { t, en } = useLang();
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
  const { t, en } = useLang();
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
        <div style={{ height: 30, width: "50%", borderRadius: 2, background: theme.surfaceRaised, animation: "hlSkeletonPulse 1.4s ease-in-out infinite" }} />
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
  const { t, en } = useLang();
  const theme = useTheme();
  const today = todayStr();
  const todayEntry = dayLogs.find((d) => d.date === today);

  const [editing, setEditing] = useState(!todayEntry || !hasCheckinData(todayEntry));
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
    const entry = {
      ...(todayEntry || {}),
      id: todayEntry?.id || uid(),
      date: today,
      mood,
      energy,
      sleep,
      note,
    };
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
                width: 28, height: 28, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: "pointer",
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
        <div ref={trackInnerRef} style={{
          display: "flex", alignItems: "center", gap: 8, background: tint(theme.lift, 0.18),
          border: `1px solid ${theme.lift}`, borderRadius: 2, padding: "8px 12px", marginBottom: 12,
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
              {hasCheckinData(todayEntry)
                ? `${t("기분", "Mood")} ${todayEntry.mood || "—"}/5 · ${t("에너지", "Energy")} ${todayEntry.energy || "—"}/5 · ${t("수면", "Sleep")} ${todayEntry.sleep || "—"}/5${todayEntry.activityLevel ? ` · ${t("활동량", "Activity")} ${todayEntry.activityLevel}/5` : ""}`
                : t("휴식 완료 기록만 있습니다. 체크인을 추가해보세요.", "Rest completed. Add a check-in when ready.")}
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
                background: theme.darkPanel || theme.surface, border: `1px solid ${theme.border}`, borderRadius: 2,
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
  const { t, en } = useLang();
  const theme = useTheme();
  const updateExercise = (idx, field, value) => {
    const next = program.exercises.map((ex, i) => (
      i === idx ? { ...ex, [field]: value } : ex
    ));
    onChange({ ...program, exercises: next });
  };
  const addExercise = () => onChange({ ...program, exercises: [...program.exercises, { id: uid(), name: "", sets: 2, repRange: "6-12", muscle: null, warmupSets: 1 }] });
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 6 }}>
            <Select value={ex.muscle || ""} onChange={(e) => updateExercise(idx, "muscle", e.target.value || null)}
              style={{ padding: "6px 8px", fontSize: 12, minHeight: 36 }}>
              <option value="">{t("부위 선택 (선택)", "Muscle group (optional)")}</option>
              {Object.entries(MUSCLE_GROUPS).map(([id, g]) => (
                <option key={id} value={id}>{g.label(t)}</option>
              ))}
            </Select>
            <Select value={String(ex.warmupSets ?? 1)} onChange={(e) => updateExercise(idx, "warmupSets", Number(e.target.value))}
              style={{ padding: "6px 8px", fontSize: 12, minHeight: 36 }}>
              {[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{t(`웜업 ${n}`, `${n} warmup`)}</option>)}
            </Select>
            </div>
          </div>
        ))}
        {program.exercises.length === 0 && (
          <div style={{ fontSize: 12, color: theme.textFaint, padding: "4px 0" }}>{t("운동이 없습니다. 아래에서 추가하세요.", "No exercises yet. Add one below.")}</div>
        )}
      </div>
      <button onClick={addExercise}
        style={{ background: "none", border: `1px dashed ${theme.border}`, borderRadius: 2, padding: "6px 10px", color: theme.textDim, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
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
  const { lang, t, en } = useLang();
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
    padding: "8px 4px", borderRadius: 2, fontSize: 12.5, flex: 1,
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
                  padding: "7px 12px", borderRadius: 2, fontSize: 12.5,
                  border: `1px solid ${programId === p.id ? theme.lift : theme.border}`,
                  background: programId === p.id ? tint(theme.lift, 0.16) : "transparent",
                  color: theme.text, cursor: "pointer",
                }}>
                {p.name}
              </button>
            ))}
            <button onClick={() => setShowNewProgram((v) => !v)}
              style={{ padding: "7px 12px", borderRadius: 2, fontSize: 12.5, border: `1px dashed ${theme.border}`, background: "transparent", color: theme.textDim, cursor: "pointer" }}>
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

function GoalTargetsPanel({ settings, onSaveSettings, effectiveTdee, currentWeight, currentBF, weekPlan, bmr = null }) {
  const { t, en } = useLang();
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
            flex: 1, minHeight: 42, borderRadius: 2, fontSize: 12, cursor: "pointer",
            border: `1px solid ${mode === m.id ? theme.lift : theme.border}`,
            background: mode === m.id ? theme.lift : "transparent",
            color: mode === m.id ? (theme.heroText || "#0A0A0A") : theme.textDim, fontWeight: 600,
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

  const TierRow = ({ tierKey, label, target, macros, selected, onSelect, limitNote, limitWarning = false }) => (
    <button onClick={onSelect} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} style={{
      display: "flex", alignItems: "flex-start", gap: 12, width: "100%", textAlign: "left",
      background: "transparent",
      border: "none", borderTop: `1px solid ${theme.border}`,
      borderLeft: `2px solid ${selected ? theme.lift : "transparent"}`,
      padding: "13px 0 13px 12px", cursor: "pointer",
    }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: selected ? theme.lift : theme.text, fontWeight: selected ? 700 : 500 }}>{label}</span>
          <span style={{ fontSize: 15, color: theme.text, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{Math.round(target)} <span style={{ fontSize: 11, color: theme.textDim, fontFamily: MONO_FONT_STACK }}>kcal</span></span>
        </div>
        <div style={{ fontSize: 11.5, color: theme.textFaint, fontFamily: MONO_FONT_STACK, letterSpacing: "0.03em" }}>
          {t("단백", "P")} {macros.proteinG}g · {t("탄수", "C")} {macros.carbG}g · {t("지방", "F")} {macros.fatG}g
        </div>
        {limitNote && (
          <div style={{
            fontSize: 10.5,
            color: limitWarning ? theme.danger : theme.textFaint,
            fontFamily: MONO_FONT_STACK,
            letterSpacing: "0.02em",
            lineHeight: 1.4,
            marginTop: 2,
            fontWeight: limitWarning ? 700 : 500,
          }}>
            {limitWarning && <span aria-hidden="true" style={{ marginRight: 5 }}>⚠</span>}
            {limitNote}
          </div>
        )}
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
  // Intake floor uses the engine's shared BMR estimate (Mifflin → Katch →
  // fallback) so it's identical to the target computed on other screens.
  const bmrForFloor = bmr ?? null;
  const standardTarget = dailyTargetForRate(effectiveTdee, currentWeight, CUT_TIERS.standard.frac, bmrForFloor, settings.sex);
  const cycle = trainingDays > 0 ? cycleTargets(Math.round(standardTarget), trainingDays) : null;
  const cheatBudget = specialDayBudget(Math.round(effectiveTdee), Math.round(standardTarget), 1, bmrForFloor, settings.sex);

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
              {(() => {
                const clinicalFloor = settings.sex === "female" ? 1200 : 1500;
                const floorVal = Math.max(clinicalFloor, bmrForFloor || 0);
                const floorLabel = (bmrForFloor && bmrForFloor >= clinicalFloor)
                  ? `BMR ~${Math.round(bmrForFloor)}`
                  : `${Math.round(floorVal)}`;
                return Object.entries(CUT_TIERS).map(([key, def]) => {
                  // Single source: computeCutTarget owns the floor/cap logic and
                  // reports the real achievable rate, so the note can never drift
                  // out of sync with the number it's explaining.
                  const cut = computeCutTarget(effectiveTdee, currentWeight, def.frac, bmrForFloor, settings.sex);
                  const target = cut.target;
                  const macros = macrosFor(target, currentWeight, settings.sex, currentBF, carbPercent);
                  const range = recommendedLossRateRange(settings.sex, currentBF);
                  const outOfRange = range && (def.frac < range[0] || def.frac > range[1]);
                  const limited = cut.flooredByIntake || cut.deficitCapped;
                  const effRatePct = cut.effectiveRateFrac * 100;
                  const limitNote = !limited ? null
                    : cut.flooredByIntake
                      ? t(`최소 섭취 한도(${floorLabel}) 도달 · 실제 ~${effRatePct.toFixed(2)}%/주`,
                          `At min-intake limit (${floorLabel}) · actual ~${effRatePct.toFixed(2)}%/wk`)
                      : t(`안전 상한으로 제한됨 · 실제 ~${effRatePct.toFixed(2)}%/주`,
                          `Capped for safety · actual ~${effRatePct.toFixed(2)}%/wk`);
                  return (
                    <div key={key}>
                      <TierRow tierKey={key} label={def.label(t)} target={target} macros={macros}
                        selected={activeTier === key} onSelect={(e) => setTier(key, e)}
                        limitNote={limitNote} limitWarning={cut.flooredByIntake} />
                      {outOfRange && activeTier === key && !limited && (
                        <div style={{ fontSize: 12, color: theme.danger, marginTop: 4, paddingLeft: 4, lineHeight: 1.4 }}>
                          {def.frac > range[1]
                            ? t("현재 체지방 기준 권장 범위보다 빨라요.", "Faster than the recommended range for your current body fat.")
                            : t("권장 범위보다 느려요 — 안전하지만 목표까지 더 오래 걸려요.", "Slower than the recommended range — safe, but will take longer to reach your goal.")}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            {cycle && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 12, color: theme.textFaint, letterSpacing: "0.04em" }}>
                  {t(`표준 기준 · 운동일 ${trainingDays}일/주`, `Standard tier · ${trainingDays} training days/wk`)}
                </div>
                <Stat label={t("운동일 목표", "Training day")} value={`${cycle.training} kcal`} />
                <Stat label={t("휴식일 목표", "Rest day")} value={`${cycle.rest} kcal`} />
                <Stat label={t("치팅데이 예산 (주 1회)", "Cheat day budget (1x/wk)")} value={`${cheatBudget.special} kcal`} />
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
  const { lang, t, en } = useLang();
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
  const flipTimerRef = useRef(null);
  useEffect(() => () => { if (flipTimerRef.current) clearTimeout(flipTimerRef.current); }, []);
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
      .filter(([date]) => parseLocalDate(date) >= cutoff)
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
    const days = (nowDate() - parseLocalDate(e.date)) / 86400000;
    return days <= 21;
  });
  let weeklyRate = null;
  if (recentCut.length >= 2) {
    const first = recentCut[0];
    const last = recentCut[recentCut.length - 1];
    const days = (parseLocalDate(last.date) - parseLocalDate(first.date)) / 86400000;
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

  const daysSinceStart = settings.startDate ? Math.max(0, Math.round((nowDate() - parseLocalDate(settings.startDate)) / 86400000)) : null;
  const daysSinceLastWeighIn = sorted.length ? Math.round((nowDate() - parseLocalDate(sorted[sorted.length - 1].date)) / 86400000) : null;

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
  // Shared targetTdee baseline (see helper) keeps this identical to every
  // other screen; observed-only is a last-resort display fallback when the
  // model can't run yet.
  const effectiveTdee = targetTdee(settings, engine) ?? (observed ? observed.tdee : null);
  const activeTarget = useMemo(
    () => (effectiveTdee ? computeActiveTarget(settings, effectiveTdee, currentWeight, currentBF, engine?.bmr) : null),
    [settings, effectiveTdee, currentWeight, currentBF, engine?.bmr]
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
                style={{ background: theme.lift, border: "none", borderRadius: 2, padding: "0 14px", color: theme.heroText, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
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
          flipTimerRef.current = setTimeout(() => { setFlipped((f) => !f); setFlipAnim(false); }, 150);
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
                bmr={engine?.bmr}
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
                          width: "100%", aspectRatio: "1", borderRadius: 2,
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
                    cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 2,
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
                    borderRadius: 2, padding: "6px 10px", marginBottom: 6,
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
      animation: "hlSheetIn 0.34s cubic-bezier(0.22, 1, 0.36, 1)",
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
        <div style={{ color: accent || theme.lift, fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 7, fontFamily: MONO_FONT_STACK }}>{eyebrow}</div>
        <div style={{ color: theme.text, fontSize: 26, lineHeight: 1.05, fontWeight: 600, fontFamily: SERIF_FONT_STACK, fontStyle: "italic", letterSpacing: "-0.01em" }}>{title}</div>
        {meta && <div style={{ color: theme.textDim, fontSize: 11, marginTop: 8, fontFamily: MONO_FONT_STACK, letterSpacing: "0.08em", textTransform: "uppercase" }}>{meta}</div>}
      </div>
      {onClose && <IconBtn onClick={onClose} label="Close"><X size={18} /></IconBtn>}
    </div>
  );
}

// In-card vertical scroll picker. No popup — scroll/drag to snap a value into
// the centered highlight. Used in the guided session so weight/reps can be set
// without opening a dialog. Lives inside a FullscreenPortal (which is
// overflow:hidden), so its own vertical scroll doesn't fight a page scroll.
function InlineWheel({ label, value, onChange, min = 0, max = 100, step = 1, unit = "", accent }) {
  const theme = useTheme();
  const ref = useRef(null);
  const settleRef = useRef(null);
  const suppressRef = useRef(false);
  const ITEM_H = 40;
  const values = useMemo(() => {
    const out = [];
    const count = Math.floor((max - min) / step);
    for (let i = 0; i <= count; i++) out.push(Number((min + i * step).toFixed(2)));
    return out;
  }, [min, max, step]);
  const selected = value === "" || value == null ? null : Number(value);
  const idx = selected == null ? -1 : Math.round((selected - min) / step);
  // Keep the scroll position in sync when the value changes from outside
  // (carry-over, +/- elsewhere, warmup suggestions).
  useEffect(() => {
    const el = ref.current;
    if (!el || idx < 0) return;
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) < 1) return;
    suppressRef.current = true;
    el.scrollTop = target;
    const t = setTimeout(() => { suppressRef.current = false; }, 80);
    return () => clearTimeout(t);
  }, [idx]);
  const onScroll = () => {
    if (suppressRef.current) return;
    const el = ref.current;
    if (!el) return;
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const i = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ITEM_H)));
      const v = values[i];
      if (v != null && String(v) !== String(selected)) onChange(String(v));
    }, 90);
  };
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: theme.textFaint, fontFamily: MONO_FONT_STACK, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6, textAlign: "center" }}>{label}</div>
      <div style={{ position: "relative", height: ITEM_H * 3, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ position: "absolute", top: ITEM_H, left: 6, right: 6, height: ITEM_H, border: `1.5px solid ${accent || theme.lift}`, borderRadius: 6, pointerEvents: "none", zIndex: 1 }} />
        <div ref={ref} onScroll={onScroll} data-no-tab-swipe="true" style={{ height: "100%", overflowY: "auto", scrollSnapType: "y mandatory", paddingTop: ITEM_H, paddingBottom: ITEM_H, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
          {values.map((n) => (
            <div key={n} onClick={() => onChange(String(n))} style={{ height: ITEM_H, display: "flex", alignItems: "center", justifyContent: "center", scrollSnapAlign: "center", fontSize: selected === n ? 24 : 18, lineHeight: 1, fontWeight: selected === n ? 850 : 500, color: selected === n ? (accent || theme.lift) : theme.textFaint, cursor: "pointer", fontVariantNumeric: "tabular-nums", transition: "color .08s" }}>
              {n}{unit ? <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 3, opacity: 0.7 }}>{unit}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function NumericWheelButton({ label, value, onChange, min = 0, max = 100, step = 1, unit = "", accent, compact = false, stepper = false, stepperStep = null }) {
  const { t } = useLang();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selectedRef = useRef(null);
  const values = useMemo(() => {
    const out = [];
    const count = Math.floor((max - min) / step);
    for (let i = 0; i <= count; i++) out.push(Number((min + i * step).toFixed(2)));
    return out;
  }, [min, max, step]);
  const selected = value === "" || value == null ? null : Number(value);
  const clampValue = (next) => Math.min(max, Math.max(min, Number(next.toFixed(2))));
  const adjust = (delta) => onChange(String(clampValue((selected ?? min) + delta)));
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => selectedRef.current?.scrollIntoView({ block: "center", behavior: "auto" }), 20);
    return () => clearTimeout(timer);
  }, [open, selected]);
  return <>
    {stepper ? (
      <div data-no-tab-swipe="true" style={{ display: "flex", alignItems: "stretch", gap: 8, width: "100%" }}>
        <button type="button" data-no-tab-swipe="true" onClick={() => adjust(-(stepperStep ?? step))} aria-label={`${label} -`} style={{ flex: "0 0 auto", width: 56, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 24, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}>−</button>
        <button type="button" data-no-tab-swipe="true" onClick={() => setOpen(true)} style={{ flex: 1, minWidth: 0, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8, padding: compact ? "6px 6px" : "8px 10px", color: theme.text, textAlign: "center", cursor: "pointer" }}>
          <div style={{ fontSize: 10, color: theme.textFaint, fontFamily: MONO_FONT_STACK, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: compact ? 22 : 34, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{selected == null ? "—" : selected}<span style={{ fontSize: 12, color: theme.textDim, marginLeft: 4 }}>{unit}</span></div>
        </button>
        <button type="button" data-no-tab-swipe="true" onClick={() => adjust(stepperStep ?? step)} aria-label={`${label} +`} style={{ flex: "0 0 auto", width: 56, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 24, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}>＋</button>
      </div>
    ) : (
    <button type="button" data-no-tab-swipe="true" onClick={() => setOpen(true)} style={{ width: "100%", background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8, padding: compact ? "8px 8px" : "12px 10px", color: theme.text, textAlign: "center", cursor: "pointer" }}>
      <div style={{ fontSize: 10, color: theme.textFaint, fontFamily: MONO_FONT_STACK, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: compact ? 22 : 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{selected == null ? "—" : selected}<span style={{ fontSize: 12, color: theme.textDim, marginLeft: 4 }}>{unit}</span></div>
    </button>
    )}
    {open && createPortal(<div role="presentation" data-no-tab-swipe="true" style={{ position: "fixed", inset: 0, zIndex: 1600, background: "rgba(0,0,0,.64)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={() => setOpen(false)}>
      <div role="dialog" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: theme.surface, borderTop: `2px solid ${accent || theme.lift}`, padding: "14px 16px calc(18px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><strong style={{ color: theme.text }}>{label}</strong><button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: theme.textDim }}><X size={18}/></button></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <button onClick={() => adjust(-step)} style={{ padding: 10, border: `1px solid ${theme.border}`, background: theme.surfaceRaised, color: theme.text, borderRadius: 8, fontSize: 14, fontWeight: 800 }}>− {step}</button>
          <button onClick={() => adjust(step)} style={{ padding: 10, border: `1px solid ${theme.border}`, background: theme.surfaceRaised, color: theme.text, borderRadius: 8, fontSize: 14, fontWeight: 800 }}>+ {step}</button>
        </div>
        <div style={{ height: 210, overflowY: "auto", scrollSnapType: "y mandatory", borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}` }}>
          {values.map((n) => <button ref={selected === n ? selectedRef : null} key={n} onClick={() => { onChange(String(n)); setOpen(false); }} style={{ width: "100%", minHeight: 52, scrollSnapAlign: "center", background: selected === n ? tint(accent || theme.lift, .16) : "transparent", border: "none", borderBottom: `1px solid ${theme.border}`, color: selected === n ? (accent || theme.lift) : theme.text, fontSize: 24, fontWeight: selected === n ? 850 : 550, cursor: "pointer" }}>{n}{unit ? ` ${unit}` : ""}</button>)}
        </div>
        <div style={{ fontSize: 11, color: theme.textFaint, textAlign: "center", marginTop: 8 }}>{t("현재 값에서 빠르게 조정하거나 다이얼처럼 스크롤하세요.", "Use quick adjustments or scroll like a dial.")}</div>
      </div>
    </div>, document.body)}
  </>;
}

// Guided, step-by-step lift session: one set at a time, with an automatic
// rest timer between sets and progressive overload built in (target reps
// climb weekly per the exercise's own repRange, weight bumps up once the
// rep ceiling is hit). Produces a workout entry in exactly the same shape
// as the manual editor, so the history/summary view doesn't need to know
// which path was used to log it.
function GuidedLiftSession({ program, onFinish, onCancel, initialDraft }) {
  const { t, en } = useLang();
  const theme = useTheme();

  const restoringRef = useRef(!!initialDraft);
  const guideSettingsLoadedRef = useRef(false);
  const [setupDone, setSetupDone] = useState(initialDraft?.setupDone ?? false);
  const [restSeconds, setRestSeconds] = useState(initialDraft?.restSeconds ?? 90);
  const [weightIncrement, setWeightIncrement] = useState(initialDraft?.weightIncrement ?? 2.5);
  const [targetOverrides, setTargetOverrides] = useState(initialDraft?.targetOverrides ?? {});
  const [smoothRemainingMs, setSmoothRemainingMs] = useState(0);
  const [restSound, setRestSound] = useState(initialDraft?.restSound ?? "classic");
  useEffect(() => { if (!initialDraft?.restSound) loadKey("restTimerSound", "classic").then((v) => setRestSound(v || "classic")); }, []);

  const [poMap, setPoMap] = useState(null); // { [key]: { weight, sessionsAtWeight, lastSessionDate, __guideSettings } }
  useEffect(() => {
    let mounted = true;
    (async () => {
      const stored = await loadKey("progressiveOverload", {});
      const guideMemory = initialDraft ? null : stored?.[GUIDE_SETTINGS_KEY]?.[guideSettingsKey(program)];
      if (!mounted) return;
      if (guideMemory) {
        if (guideMemory.restSeconds != null) setRestSeconds(Number(guideMemory.restSeconds) || 0);
        if (guideMemory.weightIncrement != null) setWeightIncrement(Number(guideMemory.weightIncrement) || 2.5);
        if (guideMemory.restSound) setRestSound(guideMemory.restSound);
        if (guideMemory.targetOverrides && typeof guideMemory.targetOverrides === "object") setTargetOverrides(guideMemory.targetOverrides);
      }
      guideSettingsLoadedRef.current = true;
      setPoMap(stored || {});
    })();
    return () => { mounted = false; };
  }, [program.id, program.name, initialDraft]);

  // Flat plan: one entry per set across every exercise (warmup + working).
  const plan = useMemo(() => {
    if (!poMap) return [];
    const items = [];
    (program.exercises || []).forEach((ex) => {
      const { startReps, maxReps } = parseRepRange(ex.repRange);
      const key = poStateKey(program.id, ex.id || ex.name);
      const poEntry = poMap[key];
      const targetReps = currentTargetReps(poEntry, startReps, maxReps);
      const workingWeight = poEntry?.weight ?? null;
      const workingCount = Math.max(1, Math.round(Number(ex.sets)) || 1);
      const warmupCount = Math.max(0, Math.min(5, Number(ex.warmupSets ?? 1)));
      const warmupRatios = warmupCount <= 1 ? [0.60] : warmupCount === 2 ? [0.50, 0.75] : warmupCount === 3 ? [0.40, 0.60, 0.80] : Array.from({ length: warmupCount }, (_, i) => 0.35 + (0.50 * i) / Math.max(1, warmupCount - 1));
      for (let i = 0; i < warmupCount; i++) {
        const ratio = warmupRatios[i] ?? 0.60;
        items.push({ exerciseId: ex.id || ex.name, exName: ex.name, muscle: ex.muscle, repRange: ex.repRange, isWarmup: true, targetReps: null, suggestedWeight: workingWeight != null ? Math.max(0, Math.round((workingWeight * ratio) / 2.5) * 2.5) : null, warmupNumber: i + 1 });
      }
      for (let i = 0; i < workingCount; i++) {
        items.push({ exerciseId: ex.id || ex.name, exName: ex.name, muscle: ex.muscle, repRange: ex.repRange, isWarmup: false, targetReps, suggestedWeight: workingWeight, isLastWorking: i === workingCount - 1, key, startReps, maxReps });
      }
    });
    return items;
  }, [poMap, program]);

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
  useEffect(() => {
    let listener;
    const syncNativeTimer = async () => {
      const state = await getNativeRestTimerState();
      if (state?.skipped) {
        setPhase("logging");
        setRestEndsAt(null);
        setRestRemaining(0);
        setSmoothRemainingMs(0);
        return;
      }
      if (state?.running && Number(state.endsAt) > Date.now()) {
        const endsAtIso = new Date(Number(state.endsAt)).toISOString();
        setRestEndsAt(endsAtIso);
        setPhase("resting");
      } else if (phase === "resting" && restEndsAt && new Date(restEndsAt).getTime() <= Date.now()) {
        setPhase("logging");
        setRestEndsAt(null);
        setRestRemaining(0);
        setSmoothRemainingMs(0);
      }
    };
    CapApp.addListener("appStateChange", ({ isActive }) => { if (isActive) syncNativeTimer(); }).then((l) => { listener = l; }).catch(() => {});
    syncNativeTimer();
    return () => { if (listener?.remove) listener.remove(); };
  }, [phase, restEndsAt]);
  const [notes, setNotes] = useState(initialDraft?.notes ?? "");
  const [startTime] = useState(() => initialDraft?.startTime || new Date().toISOString());
  const poUpdatesRef = useRef({});
  const lastAdvancedStepRef = useRef(-1);
  const lastEntryRef = useRef({}); // { [exerciseId]: { weight, reps } } — most recent working-set input, per exercise

  const current = plan[stepIdx];
  const effectiveTargetReps = current?.isWarmup ? null : Number(targetOverrides[stepIdx] ?? current?.targetReps ?? 0);
  const exerciseNames = useMemo(() => [...new Set(plan.map((item) => item.exName))], [plan]);
  const currentExerciseNumber = current ? exerciseNames.indexOf(current.exName) + 1 : 0;

  useEffect(() => {
    if (restoringRef.current) { restoringRef.current = false; return; }
    if (current) {
      // Carry over the most recent working-set input for THIS exercise so
      // multi-set exercises keep the chosen weight/reps. Uses a ref (updated
      // synchronously in logCurrentSet) rather than `log`, which is stale in
      // this stepIdx-only effect. Warmups and the first set of an exercise
      // fall back to the prescribed suggestion (weight) / target (reps).
      const carried = current.isWarmup ? null : lastEntryRef.current[current.exerciseId];
      const tReps = current.isWarmup ? 0 : Number(targetOverrides[stepIdx] ?? current.targetReps ?? 0);
      const cw = carried && carried.weight != null && carried.weight !== "" ? String(carried.weight) : null;
      const cr = carried && carried.reps != null && carried.reps !== "" ? String(carried.reps) : null;
      setWeightInput(cw != null ? cw : (current.suggestedWeight != null ? String(current.suggestedWeight) : ""));
      setRepsInput(cr != null ? cr : (tReps ? String(tReps) : ""));
    }
  }, [stepIdx, current?.suggestedWeight, current?.targetReps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!setupDone || phase === "finished") return;
    saveKey("guidedSessionDraft", {
      date: todayStr(), programId: program.id, programName: program.name,
      setupDone, restSeconds, weightIncrement, targetOverrides, restSound,
      stepIdx, phase, weightInput, repsInput, log, restEndsAt, notes, startTime,
    });
  }, [setupDone, restSeconds, weightIncrement, targetOverrides, restSound, stepIdx, phase, weightInput, repsInput, log, restEndsAt, notes, startTime, program.id, program.name]);

  useEffect(() => {
    if (!guideSettingsLoadedRef.current || initialDraft) return;
    saveGuideSettings(program, { restSeconds, weightIncrement, restSound, targetOverrides });
  }, [program, restSeconds, weightIncrement, restSound, targetOverrides, initialDraft]);

  const startWorkoutWithMemory = async () => {
    await saveGuideSettings(program, { restSeconds, weightIncrement, restSound, targetOverrides });
    setSetupDone(true);
  };

  // Date-backed timer with a requestAnimationFrame visual layer. The number updates
  // once per second, while the ring reads millisecond progress for smooth motion.
  useEffect(() => {
    if (phase !== "resting") return;
    let raf = 0, fired = false, lastShown = null;
    const frame = () => {
      const ms = restEndsAt ? Math.max(0, new Date(restEndsAt).getTime() - Date.now()) : 0;
      setSmoothRemainingMs(ms);
      const shown = Math.ceil(ms / 1000);
      if (shown !== lastShown) { lastShown = shown; setRestRemaining(shown); }
      if (ms <= 0 && !fired) { fired = true; playRestFinishSound(restSound); advance(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, restEndsAt]);

  const logCurrentSet = () => {
    if (!weightInput || !repsInput || !current) return;
    getAudioCtx(); // unlock audio on this user gesture so the rest-finish sound can play
    // Guard against impossible values slipping into the log / PO math.
    const w = Number(weightInput), r = Number(repsInput);
    if (!Number.isFinite(w) || w < 0 || w > 1000) return;
    if (!Number.isFinite(r) || r < 1 || r > 100) return;
    setLog((prev) => {
      const next = [...prev];
      let group = next.find((g) => (g.id || g.exerciseId) === current.exerciseId) || next.find((g) => !g.id && g.name === current.exName);
      if (!group) {
        group = { id: current.exerciseId, name: current.exName, repRange: current.repRange, muscle: current.muscle, sets: [] };
        next.push(group);
      }
      group.sets = [...group.sets, { weight: weightInput, reps: repsInput, setType: current.isWarmup ? "warmup" : "working", targetReps: current.isWarmup ? null : effectiveTargetReps }];
      return next;
    });
    if (!current.isWarmup) lastEntryRef.current[current.exerciseId] = { weight: weightInput, reps: repsInput };
    // Progressive overload (session-based): the last working set of an
    // exercise decides how this exercise progresses next session.
    //   - If reps hit the top of the range at the rep cap → bump weight,
    //     reset the session counter (target reps start over at the bottom).
    //   - Otherwise → keep the same weight and advance the session counter
    //     by 1, so next session's target is one rep higher (capped at max).
    if (!current.isWarmup && current.isLastWorking) {
      const prev = poMap[current.key] || {};
      const prevWeight = prev.weight ?? (Number(weightInput) || 0);
      const hitTarget = Number(repsInput) >= effectiveTargetReps;
      const achieved = hitTarget && effectiveTargetReps >= current.maxReps;
      if (achieved) {
        poUpdatesRef.current[current.key] = {
          weight: (Number(weightInput) || 0) + weightIncrement,
          sessionsAtWeight: 0,
          lastSessionDate: todayStr(),
        };
      } else {
        poUpdatesRef.current[current.key] = {
          weight: prev.weight != null ? prevWeight : (Number(weightInput) || 0),
          sessionsAtWeight: hitTarget ? Math.max(0, prev.sessionsAtWeight ?? 0) + 1 : Math.max(0, prev.sessionsAtWeight ?? 0),
          lastSessionDate: todayStr(),
        };
      }
    }
    if (current.isWarmup || restSeconds <= 0 || stepIdx + 1 >= plan.length) {
      advance();
    } else {
      const endsAt = new Date(Date.now() + restSeconds * 1000).toISOString();
      setPhase("resting");
      setRestRemaining(restSeconds);
      setRestEndsAt(endsAt);
      startNativeRestTimer(restSeconds, restSound);
    }
  };

  const advance = () => {
    if (lastAdvancedStepRef.current === stepIdx) return; // guard: only advance once per step (timer + skip can both fire)
    lastAdvancedStepRef.current = stepIdx;
    stopNativeRestTimer();
    if (stepIdx + 1 >= plan.length) {
      finishSession();
    } else {
      setRestEndsAt(null);
      setStepIdx((v) => v + 1);
      setPhase("logging");
    }
  };
  const skipRest = () => { setRestRemaining(0); setSmoothRemainingMs(0); advance(); };

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
      date: todayStr(), type: "lift", subtype: program.name, programId: program.id,
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
                    padding: "7px 10px", borderRadius: 2, fontSize: 12, cursor: "pointer",
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
                    flex: 1, padding: "9px 4px", borderRadius: 2, fontSize: 12, cursor: "pointer",
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
            <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 8 }}>{t("운동별 웜업 세트", "Warmup sets by exercise")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(program.exercises || []).map((ex) => <div key={ex.id || ex.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, padding: "8px 0" }}>
                <span style={{ fontSize: 12.5, color: theme.text }}>{ex.name}</span>
                <span style={{ fontSize: 12, color: theme.lift, fontWeight: 800 }}>{Number(ex.warmupSets ?? 1)} {t("세트", "sets")}</span>
              </div>)}
            </div>
            <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 6 }}>{t("Plan의 프로그램 편집에서 운동마다 변경할 수 있어요.", "Change each exercise in the Plan program editor.")}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 8 }}>{t("휴식 종료 알람", "Rest alarm sound")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6 }}>
              {[["classic",t("클래식 벨","Classic Bell")],["digital",t("디지털","Digital Beep")],["buzzer",t("짐 버저","Gym Buzzer")],["vibrate",t("진동만","Vibration only")]].map(([id,label]) => <button key={id} onClick={() => { setRestSound(id); saveKey("restTimerSound", id); }} style={{ padding: 9, borderRadius: 4, border: `1px solid ${restSound===id?theme.lift:theme.border}`, background: restSound===id?tint(theme.lift,.14):"transparent", color: theme.text, fontSize: 12 }}>{label}</button>)}
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <PrimaryButton onClick={startWorkoutWithMemory}>{t("운동 시작", "Start Workout")}</PrimaryButton>
      </FullscreenPortal>
    );
  }

  if (phase === "finished") {
    const totalSets = log.reduce((s, g) => s + g.sets.length, 0);
    const totalVol = Math.round(log.reduce((s, g) => s + g.sets.reduce((ss, st) => ss + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0), 0));
    const totalExercises = log.length;
    const StatCell = ({ label, value }) => (
      <div style={{ flex: 1, textAlign: "center", padding: "12px 6px", border: `1px solid ${theme.border}`, borderRadius: 2, background: theme.surface }}>
        <div style={{ fontSize: 22, fontWeight: 850, color: theme.lift, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 9.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase", color: theme.textFaint, marginTop: 5 }}>{label}</div>
      </div>
    );
    return (
      <FullscreenPortal accent={theme.lift}>
        <ExecutionHeader eyebrow={t("세션 완료", "Session complete")} title={t("수고하셨어요!", "Great work!")} meta={`${program.name}`} accent={theme.lift} />
        <div style={{ display: "flex", gap: 8, marginBottom: 14, animation: "hlViewIn 0.34s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
          <StatCell label={t("운동", "Exercises")} value={totalExercises} />
          <StatCell label={t("세트", "Sets")} value={totalSets} />
          <StatCell label={t("총 볼륨", "Volume")} value={`${totalVol.toLocaleString()}`} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, overflowY: "auto", flex: 1 }}>
          {log.map((g, i) => (
            <Card key={g.name} style={{ padding: 10, ...staggerStyle(i + 1) }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 4 }}>{g.name}</div>
              <div style={{ fontSize: 12, color: theme.textDim }}>{g.sets.map((s) => `${s.setType === "warmup" ? "W" : "S"} ${s.weight}×${s.reps}`).join(", ")}</div>
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

  // poMap loads asynchronously; until it (and therefore the plan) is ready,
  // show a brief loading state instead of a blank flash.
  if (!current) {
    return (
      <FullscreenPortal accent={theme.lift}>
        <ExecutionHeader eyebrow={t("가이드 세션", "Guided session")} title={program.name} meta={t("준비 중", "Preparing")} onClose={onCancel} accent={theme.lift} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textFaint, fontSize: 13 }}>
          {t("세션 불러오는 중…", "Loading session…")}
        </div>
      </FullscreenPortal>
    );
  }

  return (
    <FullscreenPortal accent={theme.lift}>
      <ExecutionHeader
        eyebrow={t(`운동 ${currentExerciseNumber}/${exerciseNames.length}`, `Exercise ${currentExerciseNumber}/${exerciseNames.length}`)}
        title={current.exName}
        meta={t(`세트 ${stepIdx + 1}/${plan.length} · ${current.isWarmup ? "웜업" : `목표 ${effectiveTargetReps}회`}`, `Set ${stepIdx + 1}/${plan.length} · ${current.isWarmup ? "Warmup" : `Target ${effectiveTargetReps} reps`}`)}
        onClose={onCancel}
        accent={theme.lift}
      />

      <div style={{ position: "sticky", top: 0, zIndex: 2, background: theme.bg, borderBottom: `1px solid ${theme.border}`, padding: "10px 0", marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 10.5, color: theme.textDim, fontVariantNumeric: "tabular-nums", fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
          <span>{t(`운동 ${currentExerciseNumber}/${exerciseNames.length}`, `Exercise ${currentExerciseNumber}/${exerciseNames.length}`)}</span>
          <strong style={{ color: theme.text, fontWeight: 700 }}>{t(`세트 ${stepIdx + 1}/${plan.length}`, `Set ${stepIdx + 1}/${plan.length}`)}</strong>
        </div>
        {/* tick-gauge: one segment per set, filled = done/current */}
        <div style={{ display: "flex", gap: 3 }}>
          {plan.map((s, i) => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 1,
              background: i < stepIdx ? theme.lift : (i === stepIdx ? theme.lift : theme.surfaceRaised),
              opacity: i === stepIdx ? 1 : (i < stepIdx ? 0.55 : 1),
            }} />
          ))}
        </div>
      </div>
      {phase === "logging" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
          <div style={{ textAlign: "left", borderLeft: `2px solid ${theme.lift}`, paddingLeft: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: theme.lift, letterSpacing: "0.16em", textTransform: "uppercase", fontFamily: MONO_FONT_STACK }}>{current.isWarmup ? t("웜업 세트", "WARMUP SET") : t("현재 세트", "CURRENT SET")}</div>
            <div style={{ fontSize: 13.5, color: theme.textDim, marginTop: 6, fontFamily: MONO_FONT_STACK, letterSpacing: "0.04em" }}>{current.isWarmup ? t("움직임과 자세를 확인", "CHECK MOVEMENT & FORM") : t(`목표 ${effectiveTargetReps}회 · ${current.repRange}`, `TARGET ${effectiveTargetReps} · ${current.repRange}`)}</div>
          </div>
          {(() => { const prior = log.find((g) => g.name === current.exName)?.sets?.at(-1); return prior ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "10px 14px" }}>
              <span style={{ fontSize: 10, color: theme.textFaint, fontFamily: MONO_FONT_STACK, letterSpacing: "0.12em", textTransform: "uppercase" }}>{t("직전", "Last")}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums" }}>{prior.weight}<span style={{ fontSize: 11, color: theme.textDim }}>kg</span> × {prior.reps}</span>
            </div>
          ) : null; })()}
          {!current.isWarmup && <NumericWheelButton label={t("오늘 목표 반복수", "Today's target reps")} value={String(effectiveTargetReps)} onChange={(v) => setTargetOverrides((prev) => ({ ...prev, [stepIdx]: Number(v) }))} min={current.startReps} max={current.maxReps} step={1} unit={t("회", " reps")} accent={theme.lift} />}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <InlineWheel label={t("무게", "Weight")} value={weightInput} onChange={setWeightInput} min={0} max={300} step={0.5} unit="kg" accent={theme.lift} />
            <InlineWheel label={t("실제 횟수", "Actual reps")} value={repsInput} onChange={setRepsInput} min={1} max={50} step={1} unit={t("회", "")} accent={theme.lift} />
          </div>
          <div style={{ height: 1, background: theme.border }} />
          <PrimaryButton onClick={logCurrentSet} disabled={!weightInput || !repsInput} style={{ minHeight: 64, fontSize: 13, marginTop: "auto", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: MONO_FONT_STACK, fontWeight: 700, borderRadius: 8 }}>{t("세트 기록", "Log Set")}</PrimaryButton>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textFaint, letterSpacing: "0.2em", fontFamily: MONO_FONT_STACK, textTransform: "uppercase" }}>{t("휴식 타이머", "Rest Timer")}</div>
          {(() => {
            const total = Math.max(1, restSeconds);
            const frac = Math.max(0, Math.min(1, smoothRemainingMs / (total * 1000)));
            const size = 200, stroke = 5, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
            return (
              <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0, transform: "rotate(-90deg)" }}>
                  <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={theme.surfaceRaised} strokeWidth={stroke} />
                  <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={theme.lift} strokeWidth={stroke} strokeLinecap="round"
                    strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} style={{ transition: "none" }} />
                </svg>
                <div style={{ fontSize: 60, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums", lineHeight: 0.95, letterSpacing: "-0.02em" }}>
                  {Math.floor(restRemaining / 60)}:{String(restRemaining % 60).padStart(2, "0")}
                </div>
              </div>
            );
          })()}
          <div style={{ width: "100%", borderLeft: `2px solid ${theme.lift}`, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: theme.textFaint, fontFamily: MONO_FONT_STACK, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 5 }}>{t("다음", "Next Up")}</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, color: theme.text }}>{plan[stepIdx + 1]?.exName || t("완료", "Finish")}</div>
            {plan[stepIdx + 1] && !plan[stepIdx + 1].isWarmup && <div style={{ fontSize: 11, color: theme.textDim, fontFamily: MONO_FONT_STACK, letterSpacing: "0.06em", marginTop: 4 }}>{t(`목표 ${plan[stepIdx + 1].targetReps}회`, `Target ${plan[stepIdx + 1].targetReps} reps`)}</div>}
          </div>
          <button onClick={skipRest} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 8, padding: "10px 18px", color: theme.textDim, cursor: "pointer", fontSize: 11, fontFamily: MONO_FONT_STACK, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {t("건너뛰기", "Skip Rest")}
          </button>
        </div>
      )}
    </FullscreenPortal>
  );
}

function ExerciseSetEditor({ exercises, setExercises, workouts, programName }) {
  const { t, en } = useLang();
  const theme = useTheme();

  const lastSession = useMemo(() => {
    if (!workouts || !programName) return null;
    const matches = workouts
      .filter((w) => w.subtype === programName && w.exercises && w.exercises.length > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    return matches[0] || null;
  }, [workouts, programName]);

  const lastExerciseFor = (exercise) => {
    if (!exercise) return null;
    return lastSession?.exercises.find((e) => (e.id || e.exerciseId) && (e.id || e.exerciseId) === (exercise.id || exercise.exerciseId))
      || lastSession?.exercises.find((e) => e.name === exercise.name)
      || null;
  };

  const updateSet = (exIdx, setIdx, field, value) => {
    const next = exercises.map((ex, i) => {
      if (i !== exIdx) return ex;
      return { ...ex, sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, [field]: value } : s)) };
    });
    setExercises(next);
  };
  const addSet = (exIdx) => {
    const next = exercises.map((ex, i) => (i === exIdx ? { ...ex, sets: [...ex.sets, { weight: "", reps: "", setType: "working" }] } : ex));
    setExercises(next);
  };
  const removeSet = (exIdx, setIdx) => {
    const next = exercises.map((ex, i) => (i === exIdx ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) } : ex));
    setExercises(next);
  };
  // Loads the entire last session's numbers for this exercise at once —
  // same explicit, tappable pattern as the nutrition tab's "yesterday" chips,
  // instead of a second, different (ghost-placeholder) repeat-entry idiom.
  const loadLastSession = (exIdx, exercise) => {
    const lastEx = lastExerciseFor(exercise);
    if (!lastEx) return;
    const next = exercises.map((ex, i) => {
      if (i !== exIdx) return ex;
      const newSets = ex.sets.map((s, j) => {
        const last = lastEx.sets[j];
        return last ? { weight: last.weight ? String(last.weight) : "", reps: last.reps ? String(last.reps) : "", setType: last.setType || "working", targetReps: last.targetReps ?? null } : s;
      });
      return { ...ex, id: ex.id || ex.exerciseId || uid(), sets: newSets };
    });
    setExercises(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {exercises.map((ex, exIdx) => {
        const lastEx = lastExerciseFor(ex);
        return (
        <Card key={ex.name} style={{ background: theme.surfaceRaised, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: lastEx ? 2 : 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{ex.name}</div>
            <div style={{ fontSize: 12, color: theme.textFaint }}>{t("목표 반복", "Target reps")} {ex.repRange}</div>
          </div>
          {lastEx && (
            <button onClick={() => loadLastSession(exIdx, ex)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                background: "none", border: `1px dashed ${theme.lift}`, borderRadius: 2, cursor: "pointer",
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
            {ex.sets.map((s, setIdx) => {
              const workingNumber = ex.sets.slice(0, setIdx + 1).filter((item) => item.setType !== "warmup").length;
              return (
              <div key={setIdx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={() => updateSet(exIdx, setIdx, "setType", s.setType === "warmup" ? "working" : "warmup")} style={{ fontSize: 10, color: s.setType === "warmup" ? theme.run : theme.lift, width: 46, flexShrink: 0, border: `1px solid ${s.setType === "warmup" ? theme.run : theme.lift}`, background: "transparent", padding: "5px 2px", cursor: "pointer" }}>{s.setType === "warmup" ? "WARM" : `SET ${workingNumber}`}</button>
                <div style={{ flex: 1 }}><NumericWheelButton compact label={t("무게", "Weight")} value={s.weight} onChange={(v) => updateSet(exIdx, setIdx, "weight", v)} min={0} max={300} step={0.5} unit="kg" accent={theme.lift} /></div>
                <span style={{ fontSize: 12, color: theme.textFaint }}>×</span>
                <div style={{ flex: 1 }}><NumericWheelButton compact label={t("횟수", "Reps")} value={s.reps} onChange={(v) => updateSet(exIdx, setIdx, "reps", v)} min={1} max={50} step={1} unit={t("회", " reps")} accent={theme.lift} /></div>
                <button onClick={() => removeSet(exIdx, setIdx)} disabled={ex.sets.length <= 1}
                  style={{
                    background: "none", border: "none", flexShrink: 0, padding: 4,
                    color: ex.sets.length <= 1 ? theme.border : theme.danger,
                    cursor: ex.sets.length <= 1 ? "not-allowed" : "pointer",
                  }}>
                  <X size={14} />
                </button>
              </div>
              );
            })}
          </div>
          <button onClick={() => addSet(exIdx)}
            style={{
              marginTop: 8, background: "none", border: `1px dashed ${theme.border}`, borderRadius: 2,
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
    if (w.type !== "lift" || !w.exercises || parseLocalDate(w.date) < cutoff) return;
    w.exercises.forEach((ex) => {
      if (!ex.muscle || !ex.sets) return;
      volume[ex.muscle] = (volume[ex.muscle] || 0) + ex.sets.filter((set) => set.setType !== "warmup").length;
    });
  });
  return volume;
}

function BodyMuscleDiagram({ volume, view, theme }) {
  const max = Math.max(1, ...Object.values(volume));
  const colorFor = (muscle) => {
    const v = volume[muscle] || 0;
    return v === 0 ? theme.surfaceRaised : mixHex(theme.surfaceRaised, theme.lift, 0.28 + Math.min(1, v / max) * 0.72);
  };
  const stroke = theme.border;
  return <svg width="100%" height="240" viewBox="0 0 150 240" aria-label="anatomical muscle map">
    <g fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round">
      <path d="M75 8c-11 0-18 8-18 19 0 9 5 17 12 20v9c-12 3-23 9-30 19-7 11-8 26-9 41l-5 44 12 2 8-40 3 30-5 72h19l9-61 4-35 4 35 9 61h19l-5-72 3-30 8 40 12-2-5-44c-1-15-2-30-9-41-7-10-18-16-30-19v-9c7-3 12-11 12-20 0-11-7-19-18-19z" fill={theme.surface}/>
    </g>
    {view === "front" ? <g stroke={stroke} strokeWidth="1">
      <path d="M47 64c8-8 16-11 27-10v35c-13 0-23-4-31-11z" fill={colorFor("chest")}/><path d="M103 64c-8-8-16-11-27-10v35c13 0 23-4 31-11z" fill={colorFor("chest")}/>
      <ellipse cx="42" cy="69" rx="12" ry="13" fill={colorFor("shoulders")}/><ellipse cx="108" cy="69" rx="12" ry="13" fill={colorFor("shoulders")}/>
      <path d="M31 82l14 3-8 38-13-3z" fill={colorFor("biceps")}/><path d="M119 82l-14 3 8 38 13-3z" fill={colorFor("biceps")}/>
      <path d="M58 91h34l-5 44H63z" fill={colorFor("core")}/>
      <path d="M49 139h22l-5 54H43z" fill={colorFor("quads")}/><path d="M101 139H79l5 54h23z" fill={colorFor("quads")}/>
      <path d="M43 194h23l-3 34H45z" fill={colorFor("calves")}/><path d="M107 194H84l3 34h18z" fill={colorFor("calves")}/>
    </g> : <g stroke={stroke} strokeWidth="1">
      <ellipse cx="42" cy="69" rx="12" ry="13" fill={colorFor("shoulders")}/><ellipse cx="108" cy="69" rx="12" ry="13" fill={colorFor("shoulders")}/>
      <path d="M48 58h54l-12 62H60z" fill={colorFor("back")}/>
      <path d="M31 82l14 3-8 38-13-3z" fill={colorFor("triceps")}/><path d="M119 82l-14 3 8 38 13-3z" fill={colorFor("triceps")}/>
      <path d="M53 126h44l-5 25H58z" fill={colorFor("glutes")}/>
      <path d="M49 151h22l-5 42H43z" fill={colorFor("hamstrings")}/><path d="M101 151H79l5 42h23z" fill={colorFor("hamstrings")}/>
      <path d="M43 194h23l-3 34H45z" fill={colorFor("calves")}/><path d="M107 194H84l3 34h18z" fill={colorFor("calves")}/>
    </g>}
  </svg>;
}

function MuscleGroupBreakdown({ workouts }) {
  const { t, en } = useLang();
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
                padding: "4px 9px", borderRadius: 2, fontSize: 12, cursor: "pointer",
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
                  padding: "5px 14px", borderRadius: 2, fontSize: 12, cursor: "pointer",
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
                <div style={{ width: 8, height: 8, borderRadius: 999, background: mixHex(theme.surfaceRaised, theme.lift, 0.6) }} />
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
  const { t, en } = useLang();
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
  const hh = Math.floor(elapsedSec / 3600);
  const mm = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const timerText = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
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
    borderRadius: 2, border: "none", color: "#FBFAF2",
    fontWeight: 800, fontSize: prominent ? 17 : 13, cursor: "pointer", letterSpacing: "0.01em",
  };

  if (!form.startTime) {
    return (
      <button onClick={start} style={{ ...actionStyle, background: theme.lift, color: theme.heroText }}>
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
      <button onClick={reset} style={{ background: "none", border: `1px solid ${theme.border}`, borderRadius: 2, padding: prominent ? "10px 14px" : "6px 10px", color: theme.textDim, fontSize: prominent ? 13 : 11.5, cursor: "pointer" }}>
        {t("재설정", "Reset")}
      </button>
    </div>
  );
}

function WorkoutsTab({ isActive = true, modalOnly = false, workouts, setWorkouts, programs, initialMode, initialProgramId, initialEditId, editSignal }) {
  const { lang, t, en } = useLang();
  const theme = useTheme();
  const firstProgram = programs.find((p) => p.id === initialProgramId) || programs[0] || null;
  const firstProgramName = firstProgram?.name || "기타";
  const findProgram = (name) => programs.find((p) => p.name === name);
  const exercisesFor = (name) => makeExercisesFromPlan(findProgram(name)?.exercises, lang);

  const [form, setForm] = useState(
    initialMode === "run"
      ? { date: todayStr(), type: "run", subtype: "S.R", duration: "", durationMin: "", durationSec: "", distance: "", hr: "", notes: "", exercises: [] }
      : { date: todayStr(), type: "lift", subtype: firstProgramName, duration: "", distance: "", hr: "", notes: "", exercises: exercisesFor(firstProgramName) }
  );
  const [showForm, setShowForm] = useState(false);
  const workoutFormRef = useRef(null);
  const [showProgramPicker, setShowProgramPicker] = useState(false);
  const [guidedProgram, setGuidedProgram] = useState(null);
  const [guidedDraft, setGuidedDraft] = useState(null);
  const [quickLift, setQuickLift] = useState({ date: todayStr(), subtype: firstProgramName, duration: "", notes: "" });
  const [quickRun, setQuickRun] = useState({ type: "run", date: todayStr(), subtype: "S.R", durationMin: "", durationSec: "", distance: "", hr: "", notes: "" });

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
    setQuickRun({ type: "run", date: todayStr(), subtype: "S.R", durationMin: "", durationSec: "", distance: "", hr: "", notes: "" });
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
  useEffect(() => {
    if (!isActive && editingId) {
      setEditingId(null);
      setShowForm(false);
    }
  }, [isActive, editingId]);
  useEditModalScrollLock(!!editingId && isActive);
  const save = () => {
    const normalizedForm = form.type === "run"
      ? { ...form, duration: durationMinutesFromParts(form.durationMin, form.durationSec) || form.duration }
      : form;
    if (editingId) {
      setWorkouts(workouts.map((w) => (w.id === editingId ? { ...w, ...normalizedForm } : w)));
    } else {
      const entry = { id: uid(), ...normalizedForm, programId: normalizedForm.type === "lift" ? (findProgram(normalizedForm.subtype)?.id || null) : null };
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
    const entryType = entry.type || "lift";
    const entrySubtype = entry.subtype || (entryType === "run" ? "S.R" : firstProgramName);
    setForm({
      date: entry.date || todayStr(), type: entryType, subtype: entrySubtype, duration: entry.duration || "",
      durationMin: parts.min, durationSec: parts.sec,
      startTime: entry.startTime || "", endTime: entry.endTime || "",
      distance: entry.distance || "", hr: entry.hr || "", notes: entry.notes || "",
      exercises: entry.exercises || (entryType === "lift" ? exercisesFor(entrySubtype) : []),
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
      {!modalOnly && guidedProgram && (
        <GuidedLiftSession program={guidedProgram} initialDraft={guidedDraft && guidedDraft.programId === guidedProgram.id ? guidedDraft : null} onFinish={finishGuidedSession} onCancel={cancelGuidedSession} />
      )}
      {!modalOnly && !showForm && !guidedProgram && (
        <div>
          {!showProgramPicker ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {initialMode === "run" && (
                <Card variant="feature" style={{ padding: 18, color: theme.text }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.09em", color: theme.textDim }}>CARDIO SESSION</div>
                  <div style={{ fontFamily: FONT_STACK, fontSize: 23, fontWeight: 750, marginTop: 5 }}>{t("러닝 시작", "Start cardio")}</div>
                  <div style={{ marginTop: 12, paddingTop: 11, borderTop: `1px solid ${tint(theme.heroText, 0.25)}` }}>
                    <RunTimerControl form={quickRun} setForm={setQuickRun} prominent />
                  </div>
                </Card>
              )}
              {guidedDraft && (() => {
                const draftProgram = programs.find((p) => p.id === guidedDraft.programId) || programs.find((p) => p.name === guidedDraft.programName);
                return draftProgram ? (
                  <Card style={{ borderColor: tint(theme.lift, 0.45), background: tint(theme.lift, 0.08) }}>
                    <SectionTitle>{en("진행 중인 가이드 세션", "In-progress guided session")}</SectionTitle>
                    <div style={{ fontSize: 13, color: theme.textDim, lineHeight: 1.45, marginBottom: 12 }}>{draftProgram.name} · {t("중간에 멈춘 세션을 이어갈 수 있어요.", "Resume where you left off.")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                      <PrimaryButton onClick={() => startGuidedProgram(draftProgram, guidedDraft)}>{t("이어하기", "Resume")}</PrimaryButton>
                      <button onClick={discardGuidedDraft} style={{ minHeight: 46, padding: "0 14px", borderRadius: 2, border: `1px solid ${theme.danger}`, background: "transparent", color: theme.danger, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{t("삭제", "Delete")}</button>
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
                    <button type="button" data-no-tab-swipe="true" onClick={() => firstProgram && startGuidedProgram(firstProgram)} disabled={!firstProgram} style={{ minHeight: 46, padding: "0 14px", borderRadius: 2, border: "none", background: theme.lift, color: theme.heroText, fontSize: 14, fontWeight: 800, cursor: "pointer" }}><Dumbbell size={16} style={{ verticalAlign: -3, marginRight: 5 }} />{t("시작", "Start")}</button>
                  </div>
                </Card>
              )}

              {initialMode === "run" ? (
                <Card>
                  <SectionTitle>{en("수동 유산소 기록", "Manual cardio log")}</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <Field label={t("날짜", "Date")}><TextInput type="date" value={quickRun.date} onChange={(e) => setQuickRun({ ...quickRun, date: e.target.value })} /></Field>
                    <Field label={t("종류", "Type")}><Select value={quickRun.subtype} onChange={(e) => setQuickRun({ ...quickRun, subtype: e.target.value })}>{runSubtypes.map((s) => <option key={s} value={s}>{s === "기타" ? t("기타", "Other") : s === "S.R" ? "Short" : s === "L.R" ? "Long" : s}</option>)}</Select></Field>
                    <Field label={t("거리", "Distance")}><UnitInput type="number" step="0.1" unit="km" value={quickRun.distance} onChange={(e) => setQuickRun({ ...quickRun, distance: e.target.value })} placeholder="5" /></Field>
                    <Field label={t("분", "Minutes")}><UnitInput type="number" inputMode="numeric" unit={t("분", "min")} value={quickRun.durationMin} onChange={(e) => setQuickRun({ ...quickRun, durationMin: e.target.value })} placeholder="30" /></Field>
                    <Field label={t("초", "Seconds")}><UnitInput type="number" inputMode="numeric" unit={t("초", "sec")} value={quickRun.durationSec} onChange={(e) => setQuickRun({ ...quickRun, durationSec: e.target.value })} placeholder="00" /></Field>
                    <Field label={t("평균 심박", "Avg HR")}><UnitInput type="number" inputMode="numeric" unit="bpm" value={quickRun.hr} onChange={(e) => setQuickRun({ ...quickRun, hr: e.target.value })} placeholder="135" /></Field>
                    <Field label={t("메모", "Notes")}><TextInput value={quickRun.notes} onChange={(e) => setQuickRun({ ...quickRun, notes: e.target.value })} placeholder={t("선택", "Optional")} /></Field>
                  </div>
                  <PrimaryButton onClick={saveQuickRun} style={{ touchAction: "manipulation" }} disabled={!durationMinutesFromParts(quickRun.durationMin, quickRun.durationSec) && !quickRun.distance && !quickRun.notes.trim()}>{t("저장", "Save")}</PrimaryButton>
                </Card>
              ) : (
                <Card>
                  <SectionTitle>{en("수동 운동 기록", "Manual training log")}</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <Field label={t("날짜", "Date")}><TextInput type="date" value={quickLift.date} onChange={(e) => setQuickLift({ ...quickLift, date: e.target.value })} /></Field>
                    <Field label={t("프로그램", "Program")}><Select value={quickLift.subtype} onChange={(e) => setQuickLift({ ...quickLift, subtype: e.target.value })}>{liftSubtypes.map((s) => <option key={s} value={s}>{s === "기타" ? t("기타", "Other") : s}</option>)}</Select></Field>
                    <Field label={t("시간", "Duration")}><UnitInput type="number" inputMode="numeric" unit={t("분", "min")} value={quickLift.duration} onChange={(e) => setQuickLift({ ...quickLift, duration: e.target.value })} placeholder="45" /></Field>
                    <Field label={t("메모", "Notes")}><TextInput value={quickLift.notes} onChange={(e) => setQuickLift({ ...quickLift, notes: e.target.value })} placeholder={t("선택", "Optional")} /></Field>
                  </div>
                  <PrimaryButton onClick={saveQuickLift} style={{ touchAction: "manipulation" }} disabled={!quickLift.duration && !quickLift.notes.trim()}>{t("수동 기록 저장", "Save manual log")}</PrimaryButton>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <SectionTitle right={<IconBtn onClick={() => setShowProgramPicker(false)}><X size={16} /></IconBtn>}>{t("프로그램 선택", "Choose Program")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {programs.map((p) => (
                  <button key={p.id} onClick={() => startGuidedProgram(p)}
                    style={{ padding: 12, borderRadius: 2, border: `1px solid ${theme.border}`, background: "none", color: theme.text, cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: 600 }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
      <AnimatedBox style={editingId ? { overflow: "visible", height: "auto" } : undefined}>
        {!showForm ? null : (() => { const modalNode = (
          <>
          {editingId && isActive && <EditModalBackdrop onClose={() => { setShowForm(false); setEditingId(null); }} />}
          <Card ref={workoutFormRef} role={editingId ? "dialog" : undefined} data-no-tab-swipe={editingId ? "true" : undefined} className={editingId ? "edit-compact-modal" : undefined} style={editingId && isActive ? editModalCardStyle(theme) : undefined} onClick={editingId ? (e) => e.stopPropagation() : undefined} onPointerDown={editingId ? (e) => e.stopPropagation() : undefined} data-dirty-form={editingId || form.type === "lift" || !!form.startTime || !!form.calories ? "true" : "false"}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: editingId ? 6 : 10 }}>
            <SectionTitle>{editingId ? t("기록 수정", "Edit Entry") : t("새 기록", "New Entry")}</SectionTitle>
            <span data-form-cancel="true" style={{ display: "contents" }}><IconBtn onClick={() => { setShowForm(false); setEditingId(null); }}><X size={16} /></IconBtn></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {form.type === "run" && (
              <div style={{
                padding: 14, borderRadius: 2, background: tint(theme.run, 0.12),
                border: `1px solid ${tint(theme.run, 0.42)}`, display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: theme.run, letterSpacing: "0.04em" }}>
                  {t("러닝 세션", "RUN SESSION")}
                </div>
                <RunTimerControl form={form} setForm={setForm} prominent />
              </div>
            )}
            {(form.type !== "run" || editingId || form.endTime || form.duration) && (<>
            {form.type === "lift" && (
              <div style={{ display: "flex", gap: 6, flexWrap: editingId ? "wrap" : "nowrap", minWidth: 0 }}>
                {liftSubtypes.map((s) => (
                  <button key={s} onClick={() => chooseSubtype(s)}
                    style={{
                      flex: editingId ? "1 1 92px" : 1, minWidth: 0, padding: editingId ? "5px 3px" : "8px 4px", borderRadius: 2, fontSize: editingId ? 11.5 : 12.5,
                      border: `1px solid ${form.subtype === s ? theme.lift : theme.border}`,
                      background: form.subtype === s ? tint(theme.lift, 0.16) : "transparent",
                      color: theme.text, cursor: "pointer",
                    }}>
                    {s === "기타" ? t("기타", "Other") : s}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: editingId ? 6 : 10, minWidth: 0 }}>
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
              editingId ? (
                <details style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 4 }}>
                  <summary style={{ fontSize: 11.5, color: theme.textDim, cursor: "pointer", fontWeight: 700 }}>
                    {t("세트 상세 편집 펼치기", "Expand set details")}
                  </summary>
                  <div style={{ marginTop: 6 }}>
                    <ExerciseSetEditor
                      exercises={form.exercises}
                      setExercises={(exercises) => setForm({ ...form, exercises })}
                      workouts={workouts}
                      programName={form.subtype}
                    />
                  </div>
                </details>
              ) : (
                <ExerciseSetEditor
                  exercises={form.exercises}
                  setExercises={(exercises) => setForm({ ...form, exercises })}
                  workouts={workouts}
                  programName={form.subtype}
                />
              )
            )}

            <Field label={t("메모", "Notes")}>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={form.type === "lift" ? t("컨디션, 폼 체크 등", "Condition, form notes, etc.") : t("예: 컨버세이셔널 페이스 유지", "e.g. Kept a conversational pace")}
                style={{ ...getInputStyle(theme), minHeight: editingId ? 34 : 50, maxHeight: editingId ? 54 : undefined, resize: "vertical", fontFamily: "inherit" }} />
            </Field>
            <PrimaryButton onClick={save}>{editingId ? t("수정 완료", "Save Changes") : t("저장", "Save")}</PrimaryButton>
            </>)}
          </div>
        </Card>
          </>
        ); return editingId && isActive ? createPortal(modalNode, document.body) : modalNode; })()}
      </AnimatedBox>

      {!modalOnly && workouts.length > 0 && <MuscleGroupBreakdown workouts={workouts} />}

      {!modalOnly && workouts.length > 3 && (
        <div style={{ position: "relative" }}>
          <Search size={14} color={theme.textFaint} style={{ position: "absolute", left: 12, top: 11 }} />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("운동/메모 검색", "Search workouts/notes")} style={{ paddingLeft: 32 }} />
        </div>
      )}

      {!modalOnly && (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 && <EmptyState icon={Dumbbell} text={search ? t("검색 결과가 없습니다.", "No matching entries.") : t("아직 기록이 없습니다. 첫 세션을 기록해보세요.", "No entries yet. Log your first session.")} actionLabel={null} onAction={null} />}
        {sorted.map((w, i) => {
          const exSummary = formatExerciseSummary(w.exercises);
          return (
            <Card key={w.id} style={{ padding: 12, ...staggerStyle(i) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 2, flexShrink: 0,
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
      )}
    </div>
    </>
  );
}

/* ---------------------------------------------------------
   NUTRITION TAB
--------------------------------------------------------- */
function FoodCalculator({ date, mealCategory, onMealCategoryChange, customFoods, setCustomFoods, onAdd }) {
  const { lang, t, en } = useLang();
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
      date, mealCategory, meal: `${foodName(selected)} ${grams}g`,
      calories: computed.cal, protein: computed.p, carbs: computed.c, fat: computed.f,
    });
    setSelected(null); setQuery(""); setGrams(100);
  };

  return (
    <Card>
      <SectionTitle right={<Calculator size={14} color={theme.textFaint} />}>{t("음식 칼로리 계산기", "Food Calorie Calculator")}</SectionTitle>
      <Field label={t("끼니 카테고리", "Meal category")}>
        <Select value={mealCategory || "other"} onChange={(e) => onMealCategoryChange?.(e.target.value)}>
          {MEAL_CATEGORIES.map((cat) => <option key={cat} value={cat}>{mealCategoryLabel(cat, t)}</option>)}
        </Select>
      </Field>
      <div style={{ position: "relative", marginTop: 8, marginBottom: 8 }}>
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
                style={{ textAlign: "left", background: theme.surfaceRaised, border: `1px solid ${theme.border}`, borderRadius: 2, padding: "8px 10px", color: theme.text, fontSize: 12.5, cursor: "pointer" }}>
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
          <div style={{ background: theme.surfaceRaised, borderRadius: 2, padding: 10, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
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
  const { t, en } = useLang();
  const consumedPct = target > 0 ? (consumed / target) * 100 : 0;
  const over = consumed > target;
  const fillPct = Math.max(0, Math.min(100, consumedPct));
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
      <div style={{ height: 4, borderRadius: 999, background: trackColor, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2, transition: "width 0.2s ease",
          width: `${fillPct}%`, background: fillColor,
        }} />
      </div>
    </div>
  );
}

function NutritionTab({ isActive = true, settings, onSaveSettings, bodycomp, workouts, nutrition, setNutrition, customFoods, setCustomFoods, recentAvgSteps, resetSignal }) {
  const { t, en } = useLang();
  const theme = useTheme();
  const [form, setForm] = useState({ date: todayStr(), mealCategory: "other", meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null });
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("calc"); // 'calc' | 'manual'
  const [targetFlipped, setTargetFlipped] = useState(false);
  const [targetFlipAnim, setTargetFlipAnim] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const nutritionFormRef = useRef(null);
  useEffect(() => {
    if (!isActive && editingId) {
      setEditingId(null);
      setShowForm(false);
    }
  }, [isActive, editingId]);
  useEditModalScrollLock(!!editingId && isActive);

  useEffect(() => {
    setShowForm(false);
    setMode("calc");
    setTargetFlipped(false);
    setTargetFlipAnim(false);
    setEditingId(null);
    setForm({ date: todayStr(), mealCategory: "other", meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null });
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
    setForm({ date: form.date, mealCategory: form.mealCategory || "other", meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null });
    setEditingId(null);
    setShowForm(false);
  };
  const startEdit = (entry) => {
    setForm({
      date: entry.date, mealCategory: entry.mealCategory || inferMealCategory(entry.meal), meal: entry.meal || "", calories: String(entry.calories || ""),
      protein: entry.protein ? String(entry.protein) : "", carbs: entry.carbs ? String(entry.carbs) : "",
      fat: entry.fat ? String(entry.fat) : "", quality: entry.quality ?? null,
    });
    setEditingId(entry.id);
    setMode("manual");
    setShowForm(true);
  };
  // Food-calculator entries come from a structured food database with
  // known gram amounts, so they're treated as the highest-quality tier.
  const addComputed = (entry) => setNutrition([{ id: uid(), mealCategory: entry.mealCategory || form.mealCategory || "other", ...entry, quality: 1.0 }, ...nutrition]);
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
      date: todayStr(), mealCategory: entry.mealCategory || inferMealCategory(entry.meal), meal: entry.meal || "", calories: String(entry.calories || ""),
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
  const currentBF = sortedBc[sortedBc.length - 1]?.bodyfat ?? (settings.startBF || null);
  const engine = useMemo(
    () => estimateTdeeEngine(settings, bodycomp, nutrition, workouts, currentWeight, recentAvgSteps),
    [settings, bodycomp, nutrition, workouts, currentWeight, recentAvgSteps]
  );
  const observed = useMemo(() => computeObservedTdee(bodycomp, nutrition, 14), [bodycomp, nutrition]);
  const effectiveTdee = targetTdee(settings, engine) ?? observed?.tdee ?? null;
  const baseDailyTarget = computeActiveTarget(settings, effectiveTdee, currentWeight, currentBF, engine?.bmr);
  const dailyTarget = applyCheatDayTarget(settings, baseDailyTarget, effectiveTdee, engine?.bmr);
  const normalDailyTarget = baseDailyTarget?.target ?? null;
  const displayDailyTarget = dailyTarget?.target ?? normalDailyTarget;

  useEffect(() => {
    if (!settings.cheatDayActive || settings.cheatDayUsedDate !== todayStr()) return undefined;
    const now = nowDate();
    const end = nowDate();
    end.setHours(23, 59, 0, 0);
    const delay = Math.max(1000, end.getTime() - now.getTime());
    const timer = setTimeout(() => {
      if (shouldReclaimUnusedCheatDay(settings, nutrition, normalDailyTarget, todayStr())) {
        onSaveSettings(reclaimCheatDaySettings(settings));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [settings, nutrition, normalDailyTarget, onSaveSettings]);

  const todayTotals = useMemo(() => {
    return nutrition.filter((n) => n.date === todayStr()).reduce((acc, i) => ({
      cal: acc.cal + (+i.calories || 0),
      p: acc.p + (+i.protein || 0),
      c: acc.c + (+i.carbs || 0),
      f: acc.f + (+i.fat || 0),
    }), { cal: 0, p: 0, c: 0, f: 0 });
  }, [nutrition]);

  const modeLabel = dailyTarget?.blocked ? t("유지", "Maintenance") : { cut: t("다이어트", "Cut"), maintain: t("유지어트", "Maintain"), gain: t("증량", "Gain") }[dailyTarget?.mode];

  const weekKey = weekStartKey();
  const cheatDayActive = settings.cheatDayActive && settings.cheatDayUsedWeekKey === weekKey && settings.cheatDayUsedDate === todayStr();
  const cheatDayAlreadyUsed = settings.cheatDayUsedWeekKey === weekKey && !!settings.cheatDayUsedDate;
  const toggleCheatDay = () => {
    if (cheatDayActive) {
      onSaveSettings(reclaimCheatDaySettings(settings));
      return;
    }
    if (cheatDayAlreadyUsed) {
      window.alert(t("이번 주 치팅데이는 이미 사용했습니다.", "You already used this week's cheat day."));
      return;
    }
    onSaveSettings({
      ...settings,
      cheatDayEnabled: true,
      cheatDayActive: true,
      cheatDayWeekKey: weekKey,
      cheatDayDate: todayStr(),
      cheatDayUsedWeekKey: weekKey,
      cheatDayUsedDate: todayStr(),
    });
  };

  return (
    <>
    {confirmDeleteId && (
      <ConfirmDialog message={t("이 식단 기록을 삭제할까요? 되돌릴 수 없어요.", "Delete this meal entry? This can't be undone.")} onConfirm={confirmRemove} onCancel={() => setConfirmDeleteId(null)} />
    )}
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ScreenHeader
        eyebrow="Nutrition"
        title="Eat"
        subtitle={t("식사, 간식, 칼로리와 영양을 기록합니다.", "Log meals, snacks and nutrition.")}
      />
      <button onClick={toggleCheatDay} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 13px", background: cheatDayActive ? tint(theme.lift,.15) : "transparent", border: `1px solid ${cheatDayActive ? theme.lift : theme.border}`, color: theme.text, cursor: "pointer" }}>
        <div><div style={{ fontSize: 12.5, fontWeight: 800 }}>{t("오늘을 치팅데이로 사용", "Use cheat-day budget today")}</div><div style={{ fontSize: 10.5, color: theme.textFaint, marginTop: 3 }}>{t("주 1회 제한 · 일반 목표 미초과 시 23:59 자동 복구", "Once per week · auto-reclaimed at 23:59 if unused")}</div></div>
        <div style={{ width: 44, height: 26, borderRadius: 2, background: cheatDayActive ? theme.lift : theme.surfaceRaised, position: "relative", flexShrink: 0, transition: "background 0.2s ease" }}><div style={{ position: "absolute", top: 3, left: cheatDayActive ? 21 : 3, width: 20, height: 20, borderRadius: 2, background: "#F5F5F3", transition: "left 0.2s ease" }}/></div>
      </button>
      {dailyTarget && (() => {
        const target = displayDailyTarget;
        const consumedCal = todayTotals.cal;
        const over = consumedCal > target;
        const remainingPct = Math.max(0, 100 - (consumedCal / target) * 100);
        const dailyHistory = byDate.slice(0, 14).map(([date, entries]) => ({
          date,
          cal: entries.reduce((s, e) => s + (+e.calories || 0), 0),
        }));
        return (
          <div>
            {dailyTarget?.blocked && (
              <div style={{ fontSize: 11.5, color: theme.textDim, borderLeft: `2px solid ${theme.lift}`, paddingLeft: 10, marginBottom: 14, lineHeight: 1.4 }}>
                {t("⚠ 건강 상태 설정으로 다이어트 목표 대신 유지 칼로리를 표시 중.", "⚠ Showing maintenance calories instead of a cut target, per your health settings.")}
              </div>
            )}
            {/* LEAD NUMBER — calories remaining/over */}
            <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.18em", textTransform: "uppercase", color: theme.textFaint }}>
              {over ? en("칼로리 초과", "Calories Over") : en("칼로리 남음", "Calories Left")}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: 48, fontWeight: 800, lineHeight: 0.9, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", color: over ? theme.danger : theme.text }}>
                {over ? Math.round(consumedCal - target).toLocaleString() : Math.round(target - consumedCal).toLocaleString()}
              </span>
              <span style={{ fontSize: 12, color: theme.textDim, fontFamily: MONO_FONT_STACK }}>kcal</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <ProgressLine value={over ? 100 : Math.min(100, (consumedCal / Math.max(1, target)) * 100)} color={over ? theme.danger : theme.lift} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: theme.textFaint, marginTop: 7, fontFamily: MONO_FONT_STACK, letterSpacing: "0.04em" }}>
                <span>{en("섭취", "INTAKE")} {Math.round(consumedCal).toLocaleString()}</span>
                <span>{en("목표", "TARGET")} {Math.round(target).toLocaleString()}</span>
              </div>
            </div>

            {/* MACRO SPEC TABLE */}
            <div style={{ marginTop: 20 }}>
              {[
                { label: en("단백질", "Protein"), consumed: todayTotals.p, target: dailyTarget.macros.proteinG },
                { label: en("탄수화물", "Carbs"), consumed: todayTotals.c, target: dailyTarget.macros.carbG },
                { label: en("지방", "Fat"), consumed: todayTotals.f, target: dailyTarget.macros.fatG },
              ].map((m) => {
                const pct = m.target > 0 ? Math.min(100, (m.consumed / m.target) * 100) : 0;
                return (
                  <div key={m.label} style={{ display: "grid", gridTemplateColumns: "68px 1fr 92px", alignItems: "center", gap: 12, padding: "12px 0", borderTop: `1px solid ${theme.border}` }}>
                    <span style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.08em", textTransform: "uppercase", color: theme.textDim }}>{m.label}</span>
                    <div style={{ height: 3, background: theme.surfaceRaised, borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: theme.lift, transition: "width 0.2s ease" }} />
                    </div>
                    <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", color: theme.text, textAlign: "right", fontFamily: MONO_FONT_STACK }}>
                      {Math.round(m.consumed)}<span style={{ color: theme.textFaint }}> / {m.target}g</span>
                    </span>
                  </div>
                );
              })}
              <RuleLine />
            </div>

            {/* INTAKE HISTORY — collapsible, not a hidden flip */}
            {dailyHistory.length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint, cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>{en("일별 섭취 기록", "Intake History")}</span>
                  <ChevronDown size={13} />
                </summary>
                <div style={{ marginTop: 8 }}>
                  {dailyHistory.map(({ date, cal }) => {
                    const dayOver = cal > target;
                    return (
                      <div key={date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${theme.border}` }}>
                        <span style={{ fontSize: 12.5, fontStyle: "italic", fontFamily: SERIF_FONT_STACK, color: theme.textDim }}>{fmtDate(date)}</span>
                        <span style={{ fontSize: 12, fontFamily: MONO_FONT_STACK, fontVariantNumeric: "tabular-nums", color: dayOver ? theme.danger : theme.text }}>
                          {Math.round(cal).toLocaleString()} kcal
                        </span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
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
                  padding: "7px 10px", borderRadius: 2, border: `1px solid ${theme.border}`,
                  background: theme.surfaceRaised, color: theme.text, cursor: "pointer", minWidth: 88,
                }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{entry.meal || mealCategoryLabel(entry.mealCategory || inferMealCategory(entry.meal), t)}</span>
                <span style={{ fontSize: 12, color: theme.textFaint }}>{entry.calories}kcal</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" data-no-tab-swipe="true" onClick={() => { setMode("calc"); setShowForm(false); setEditingId(null); }}
          style={{ flex: 1, minHeight: 44, borderRadius: 2, fontSize: 12, fontWeight: 600, border: `1px solid ${mode === "calc" ? theme.lift : theme.border}`, background: mode === "calc" ? theme.lift : "transparent", color: mode === "calc" ? (theme.heroText || "#0A0A0A") : theme.textDim, cursor: "pointer" }}>
          {t("음식 계산기", "Food Calculator")}
        </button>
        <button type="button" data-no-tab-swipe="true" onClick={() => { setMode("manual"); setShowForm(true); setEditingId(null); setForm({ date: todayStr(), mealCategory: "other", meal: "", calories: "", protein: "", carbs: "", fat: "", quality: null }); }}
          style={{ flex: 1, minHeight: 44, borderRadius: 2, fontSize: 12, fontWeight: 600, border: `1px solid ${mode === "manual" ? theme.lift : theme.border}`, background: mode === "manual" ? theme.lift : "transparent", color: mode === "manual" ? (theme.heroText || "#0A0A0A") : theme.textDim, cursor: "pointer" }}>
          {t("직접 입력", "Manual Entry")}
        </button>
      </div>

      <AnimatedBox>
        {mode === "calc" ? (
          <FoodCalculator date={form.date} mealCategory={form.mealCategory} onMealCategoryChange={(mealCategory) => setForm({ ...form, mealCategory })} customFoods={customFoods} setCustomFoods={setCustomFoods} onAdd={addComputed} />
        ) : (
          !showForm ? (
            <PrimaryButton onClick={() => setShowForm(true)}><Plus size={16} /> {t("식사 기록 추가", "Add Meal")}</PrimaryButton>
          ) : (
            (() => { const modalNode = (
            <>
            {editingId && isActive && <EditModalBackdrop onClose={() => { setShowForm(false); setEditingId(null); }} />}
            <Card ref={nutritionFormRef} role={editingId ? "dialog" : undefined} data-no-tab-swipe={editingId ? "true" : undefined} className={editingId ? "edit-compact-modal" : undefined} style={editingId && isActive ? editModalCardStyle(theme) : undefined} onClick={editingId ? (e) => e.stopPropagation() : undefined} onPointerDown={editingId ? (e) => e.stopPropagation() : undefined}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <SectionTitle>{editingId ? t("식단 수정", "Edit Meal") : en("새 식사", "New Meal")}</SectionTitle>
                <IconBtn onClick={() => setShowForm(false)}><X size={16} /></IconBtn>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: editingId ? 6 : 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: editingId ? 6 : 10, minWidth: 0 }}>
                  <Field label={t("날짜", "Date")}><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                  <Field label={t("끼니 카테고리", "Meal category")}><Select value={form.mealCategory || "other"} onChange={(e) => setForm({ ...form, mealCategory: e.target.value })}>{MEAL_CATEGORIES.map((cat) => <option key={cat} value={cat}>{mealCategoryLabel(cat, t)}</option>)}</Select></Field>
                  <Field label={t("아이템명(선택)", "Item name (optional)")}><TextInput value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })} placeholder={t("닭가슴살 / 라떼 / 외식", "Chicken / latte / eating out")} /></Field>
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
                          flex: 1, padding: editingId ? "4px 2px" : "6px 2px", borderRadius: 2, fontSize: editingId ? 11 : 12, cursor: "pointer",
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
            </>
            ); return editingId && isActive ? createPortal(modalNode, document.body) : modalNode; })()
          )
        )}
      </AnimatedBox>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {byDate.length === 0 && <EmptyState icon={Utensils} text={t("아직 식사 기록이 없습니다.", "No meals logged yet.")} />}
        {byDate.map(([date, items], gi) => {
          const totals = items.reduce((acc, i) => ({
            cal: acc.cal + (+i.calories || 0),
            p: acc.p + (+i.protein || 0),
            c: acc.c + (+i.carbs || 0),
            f: acc.f + (+i.fat || 0),
          }), { cal: 0, p: 0, c: 0, f: 0 });
          return (
            <Card key={date} style={{ padding: 12, ...staggerStyle(gi) }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{fmtDate(date)}</div>
                <div style={{ fontSize: 12, color: theme.run, fontWeight: 700 }}>{mealCategoryCount(items)} {t("끼니", "meals")} · {totals.cal} kcal</div>
              </div>
              <div style={{ fontSize: 12, color: theme.textDim, marginBottom: 8 }}>
                {t("단백질", "Protein")} {totals.p}g · {t("탄수", "Carbs")} {totals.c}g · {t("지방", "Fat")} {totals.f}g
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {groupedNutritionItems(items).map(([cat, catItems]) => {
                  const catTotals = catItems.reduce((acc, i) => ({
                    cal: acc.cal + (+i.calories || 0),
                    p: acc.p + (+i.protein || 0),
                    c: acc.c + (+i.carbs || 0),
                    f: acc.f + (+i.fat || 0),
                  }), { cal: 0, p: 0, c: 0, f: 0 });
                  return (
                    <div key={cat} style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: theme.text }}>{mealCategoryLabel(cat, t)}</span>
                        <span style={{ fontSize: 11.5, color: theme.textFaint, fontFamily: MONO_FONT_STACK }}>{catItems.length} {t("개", "items")} · {Math.round(catTotals.cal)}kcal</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {catItems.map((i) => (
                          <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "3px 0" }}>
                            <span style={{ color: theme.textDim }}>{i.meal || t("이름 없는 아이템", "Unnamed item")} · {i.calories}kcal</span>
                            <div style={{ display: "flex", alignItems: "center" }}>
                              <IconBtn onClick={() => startEdit(i)}><Pencil size={13} /></IconBtn>
                              <IconBtn danger onClick={() => remove(i.id)}><Trash2 size={13} /></IconBtn>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
  const { t, en } = useLang();
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

  const newestByDate = new Map();
  bodycomp.forEach((entry) => {
    if (entry?.date && !newestByDate.has(entry.date)) newestByDate.set(entry.date, entry);
  });
  const chartData = [...newestByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((b) => ({
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
                      flex: 1, padding: "6px 2px", borderRadius: 2, fontSize: 12, cursor: "pointer",
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
          <SectionTitle>{en("체중 · 체지방 추이", "Weight · Body Fat Trend")}</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ left: -20, right: 10 }}>
              <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke={theme.textFaint} tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" stroke={theme.lift} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <YAxis yAxisId="right" orientation="right" stroke={theme.run} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: theme.surfaceRaised, border: `1px solid ${theme.border}`, borderRadius: 2, fontSize: 12 }} />
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
  const { t, en } = useLang();
  const [expanded, setExpanded] = useState(false);
  return (
    <Card style={eligible ? { borderColor: theme.lift } : undefined}>
      <button onClick={() => setExpanded((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", display: "block" }}>
        <SectionTitle right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {eligible && (
              <span style={{ fontSize: 12, fontWeight: 700, color: theme.lift, background: tint(theme.lift, 0.16), padding: "2px 7px", borderRadius: 2, fontStyle: "normal", fontFamily: BODY_FONT_STACK }}>
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
                <button onClick={onDismiss} style={{ flex: 1, background: "none", border: `1px solid ${theme.border}`, borderRadius: 2, color: theme.textDim, cursor: "pointer", fontSize: 13 }}>
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
  const { t, en } = useLang();
  const theme = useTheme();
  const [windowDays, setWindowDays] = useState(14);

  const sorted = [...bodycomp].sort((a, b) => a.date.localeCompare(b.date));
  const currentWeight = sorted[sorted.length - 1]?.weight ?? (settings.startWeight || null);
  const currentBF = sorted[sorted.length - 1]?.bodyfat ?? (settings.startBF || null);

  const initial = useMemo(() => computeInitialTdee(settings, currentWeight, workouts, recentAvgSteps, currentBF), [settings, currentWeight, workouts, recentAvgSteps, currentBF]);
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
  const justSavedTimerRef = useRef(null);
  useEffect(() => () => { if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current); }, []);
  const saveSnapshot = () => {
    if (!roundedTdee) return;
    setTdeeHistory([...tdeeHistory, { id: uid(), date: todayStr(), value: roundedTdee }]);
    setJustSaved(true);
    if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
    justSavedTimerRef.current = setTimeout(() => setJustSaved(false), 1800);
  };

  const chartData = [...tdeeHistory].sort((a, b) => a.date.localeCompare(b.date)).map((h) => ({ date: fmtDate(h.date), maintenance: h.value }));

  const rateTiers = [
    { key: "gentle", frac: 0.005, label: t("완만 (~0.5%/주, 근손실 최소)", "Gentle (~0.5%/wk, min muscle loss)") },
    { key: "standard", frac: 0.007, label: t("표준 (~0.7%/주)", "Standard (~0.7%/wk)") },
    { key: "fast", frac: 0.01, label: t("빠름 (~1%/주)", "Fast (~1%/wk)") },
  ];
  const targets = roundedTdee && currentWeight ? rateTiers.map(({ key, frac, label }) => {
    const target = dailyTargetForRate(roundedTdee, currentWeight, frac, initial?.bmr, settings.sex);
    const macros = macrosFor(target, currentWeight, settings.sex, currentBF, settings.carbPercent ?? null);
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
        <SectionTitle right={<span style={{ fontSize: 12, color: theme.textFaint }}>{settings.acceptedTdee ? t("승인된 보정 적용 중", "Accepted calibration active") : (initial ? (initial.bmrMethod === "mifflin" ? t("프로필 기반 모델", "Profile-based model") : initial.bmrMethod === "katch_mcardle" ? t("체지방 기반 모델", "Body-fat-based model") : t("체중 기반 임시 모델", "Weight-based fallback")) : t("실측 기반", "Observed-only"))}</span>}>
          {t("유지 칼로리 추정", "Maintenance Calorie Estimate")}
        </SectionTitle>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[7, 14, 28].map((d) => (
            <button key={d} onClick={() => setWindowDays(d)}
              style={{
                flex: 1, padding: 8, borderRadius: 2, fontSize: 12,
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
          <SectionTitle>{en("주의사항 (표준 기준)", "Notes (standard tier)")}</SectionTitle>
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
          <SectionTitle>{en("유지 칼로리 변화 추이", "Maintenance Calorie Trend")}</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ left: -20, right: 10 }}>
              <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke={theme.textFaint} tick={{ fontSize: 10 }} />
              <YAxis stroke={theme.textFaint} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: theme.surfaceRaised, border: `1px solid ${theme.border}`, borderRadius: 2, fontSize: 12 }} />
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
  const { t, en } = useLang();
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
              <div key={c.date} title={`${c.date}: ${c.count}`} style={{ width: 10, height: 10, borderRadius: 2, background: levelColor(c.count) }} />
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

// Minimal editorial sparkline — a bare trend line with no axes/labels,
// meant to sit under a mono label + big current value in a stat cluster.
function Sparkline({ data, width = 96, height = 30, color, down }) {
  const theme = useTheme();
  const stroke = color || theme.lift;
  if (!data || data.length < 2) {
    return <div style={{ height, display: "flex", alignItems: "center" }}><div style={{ height: 1, width: "100%", background: theme.border }} /></div>;
  }
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const n = data.length;
  const pts = data.map((v, i) => {
    const x = (i / (n - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lastX = width, lastY = height - ((data[n - 1] - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
    </svg>
  );
}

function TrendStat({ label, value, unit, delta, deltaUnit, data, color, positiveIsGood }) {
  const theme = useTheme();
  const hasDelta = delta != null && !Number.isNaN(delta) && Math.abs(delta) > 0.001;
  // For weight/bodyfat in a cut, down is good → green; up is bad → red. We
  // don't over-signal: just a subtle arrow + neutral tone unless clearly good/bad.
  const arrow = hasDelta ? (delta < 0 ? "↓" : "↑") : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.textFaint, whiteSpace: "nowrap" }}>{label} {arrow}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: theme.text, fontVariantNumeric: "tabular-nums", lineHeight: 1, letterSpacing: "-0.01em" }}>{value}</span>
        {unit && <span style={{ fontSize: 10, color: theme.textFaint, fontFamily: MONO_FONT_STACK }}>{unit}</span>}
      </div>
      <Sparkline data={data} color={color || theme.lift} />
      <div style={{ fontSize: 9.5, fontFamily: MONO_FONT_STACK, color: theme.textFaint, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
        {hasDelta ? `${delta > 0 ? "+" : ""}${delta}${deltaUnit || ""} / 30d` : "—"}
      </div>
    </div>
  );
}

function ProgressTab({ settings, onSaveSettings, bodycomp, setBodycomp, nutrition, workouts, weekPlan, tdeeHistory, setTdeeHistory, recentAvgSteps }) {
  const { t, en } = useLang(); const theme = useTheme(); const [section, setSection] = useState("body");
  const items = [{ id: "body", label: t("체성분", "Body") }, { id: "energy", label: t("유지칼로리", "Energy") }];

  // Trend series for the sparkline cluster
  const trends = useMemo(() => {
    const sorted = [...bodycomp].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const wSeries = sorted.filter((b) => b.weight != null).map((b) => ({ date: b.date, v: Number(b.weight) }));
    const bfSeries = sorted.filter((b) => b.bodyfat != null).map((b) => ({ date: b.date, v: Number(b.bodyfat) }));
    const tSeries = [...tdeeHistory].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((h) => ({ date: h.date, v: Number(h.value) }));
    const cutoff = localDateStr(new Date(Date.now() - 30 * 86400000));
    const deltaOf = (series) => {
      if (series.length < 2) return null;
      const recent = series.filter((p) => p.date >= cutoff);
      const base = recent.length >= 2 ? recent[0].v : series[0].v;
      return Math.round((series[series.length - 1].v - base) * 10) / 10;
    };
    return {
      weight: { series: wSeries.map((p) => p.v), last: wSeries.at(-1)?.v, delta: deltaOf(wSeries) },
      bodyfat: { series: bfSeries.map((p) => p.v), last: bfSeries.at(-1)?.v, delta: deltaOf(bfSeries) },
      tdee: { series: tSeries.map((p) => p.v), last: tSeries.at(-1)?.v, delta: deltaOf(tSeries) },
    };
  }, [bodycomp, tdeeHistory]);

  return <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <ScreenHeader
      eyebrow="Analytics"
      title="Progress"
      subtitle={t("몸 변화와 에너지 추세를 한 곳에서 확인하세요", "Your body and energy trends in one place")}
    />

    {/* TREND CLUSTER — instrument panel */}
    <div>
      <div style={{ fontSize: 10.5, fontFamily: MONO_FONT_STACK, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.textFaint, marginBottom: 14 }}>{en("추세 · 최근 30일", "Trends · Last 30 Days")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <TrendStat label={en("체중", "Weight")} value={trends.weight.last != null ? trends.weight.last.toFixed(1) : "—"} unit={trends.weight.last != null ? "kg" : ""} delta={trends.weight.delta} deltaUnit="kg" data={trends.weight.series} color={theme.lift} />
        <TrendStat label={en("체지방", "Body Fat")} value={trends.bodyfat.last != null ? trends.bodyfat.last.toFixed(1) : "—"} unit={trends.bodyfat.last != null ? "%" : ""} delta={trends.bodyfat.delta} deltaUnit="%" data={trends.bodyfat.series} color={theme.text} />
        <TrendStat label={en("유지칼로리", "TDEE")} value={trends.tdee.last != null ? Math.round(trends.tdee.last).toLocaleString() : "—"} unit="" delta={trends.tdee.delta != null ? Math.round(trends.tdee.delta) : null} deltaUnit="" data={trends.tdee.series} color={theme.textDim} />
      </div>
      <div style={{ marginTop: 16 }}><RuleLine /></div>
    </div>

    <div style={{ display: "flex", gap: 8 }}>{items.map((item) => <button key={item.id} onClick={() => setSection(item.id)} style={{ flex: 1, minHeight: 44, border: `1px solid ${section === item.id ? theme.lift : theme.border}`, borderRadius: 2, cursor: "pointer", color: section === item.id ? (theme.heroText || "#0A0A0A") : theme.textDim, background: section === item.id ? theme.lift : "transparent", fontSize: 11, fontWeight: 700, fontFamily: MONO_FONT_STACK, letterSpacing: "0.1em", textTransform: "uppercase" }}>{item.label}</button>)}</div>
    {section === "body" ? <BodyCompTab bodycomp={bodycomp} setBodycomp={setBodycomp} /> : <TdeeTab settings={settings} onSaveSettings={onSaveSettings} bodycomp={bodycomp} nutrition={nutrition} workouts={workouts} weekPlan={weekPlan} tdeeHistory={tdeeHistory} setTdeeHistory={setTdeeHistory} recentAvgSteps={recentAvgSteps} />}
  </div>;
}

function SettingsTab({ settings, onSaveSettings, workouts, nutrition, bodycomp, programs, onShowIntro }) {
  const { lang, t, en } = useLang();
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

  const backupFileInputRef = useRef(null);
  const [backupText, setBackupText] = useState("");
  const [backupFilename, setBackupFilename] = useState("");
  const exportJsonBackup = async () => {
    try {
      const payload = await collectBackupData();
      const date = new Date().toISOString().slice(0, 10);
      const filename = `hybrid-log-backup-${date}.json`;
      const text = JSON.stringify(payload, null, 2);
      setBackupFilename(filename);
      setBackupText(text);
      const sharedOrDownloaded = await shareJsonBackup(text, filename);
      if (!sharedOrDownloaded) {
        await copyTextToClipboard(text);
      }
    } catch (e) {
      window.alert(t("백업 파일을 만들지 못했습니다.", "Could not create the backup file."));
    }
  };
  const importJsonBackup = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ok = window.confirm(t(
      "이 백업을 가져오면 현재 앱 데이터가 백업 파일 내용으로 교체됩니다. 계속할까요?",
      "Importing this backup will replace the current app data with the file contents. Continue?"
    ));
    if (!ok) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await restoreBackupPayload(payload);
      window.alert(t("백업을 복원했습니다. 앱을 다시 시작합니다.", "Backup restored. The app will restart now."));
      window.location.reload();
    } catch (err) {
      window.alert(t("백업 파일을 읽지 못했습니다. 올바른 Hybrid Log JSON인지 확인해주세요.", "Could not read this backup. Please check that it is a valid Hybrid Log JSON file."));
    }
  };

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

      <Card>
        <SectionTitle>{t("패치노트", "Patch Notes")}</SectionTitle>
        <div style={{ fontSize: 12.5, color: theme.textDim, lineHeight: 1.55, marginBottom: 12 }}>
          {t("이번 웹/PWA 수정 내역과 바탕화면 아이콘 재생성 안내를 확인합니다.", "View the latest web/PWA changes and desktop shortcut reset instructions.")}
        </div>
        <a
          href={PATCH_NOTES_URL}
          target="_self"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 38,
            padding: "0 14px",
            borderRadius: 2,
            border: `1px solid ${theme.lift}`,
            background: tint(theme.lift, 0.12),
            color: theme.lift,
            textDecoration: "none",
            fontSize: 12.5,
            fontWeight: 750,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: MONO_FONT_STACK,
          }}
        >
          {t("패치노트 열기", "Open Patch Notes")}
        </a>
      </Card>
      <SettingsSectionLabel>{en("일반", "General")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>{en("기본 프로필", "Profile Basics")}</SectionTitle>
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
        <SectionTitle>{en("언어", "Language")}</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onSaveSettings({ ...settings, language: "ko" })}
            style={{
              flex: 1, padding: 10, borderRadius: 2, fontSize: 13, cursor: "pointer",
              border: `1px solid ${lang === "ko" ? theme.lift : theme.border}`,
              background: lang === "ko" ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
            }}>
            한국어
          </button>
          <button onClick={() => onSaveSettings({ ...settings, language: "en" })}
            style={{
              flex: 1, padding: 10, borderRadius: 2, fontSize: 13, cursor: "pointer",
              border: `1px solid ${lang === "en" ? theme.lift : theme.border}`,
              background: lang === "en" ? tint(theme.lift, 0.16) : "transparent", color: theme.text,
            }}>
            English
          </button>
        </div>
      </Card>

      <Card>
        <SectionTitle>{en("테마", "Theme")}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(PALETTES).map(([id, p]) => {
            const active = (settings.colorPalette || DEFAULT_PALETTE) === id;
            return (
              <button key={id} onClick={() => onSaveSettings({ ...settings, colorPalette: id })}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 2, cursor: "pointer",
                  border: `1px solid ${active ? theme.lift : theme.border}`,
                  background: active ? tint(theme.lift, 0.1) : "transparent",
                }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 2, flexShrink: 0,
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

      <SettingsSectionLabel>{en("자동화", "Automation")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>{en("활동 수준 자동 반영", "Activity Level Automation")}</SectionTitle>
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
              width: 44, height: 26, borderRadius: 2, border: "none", cursor: "pointer", position: "relative",
              background: settings.activityFullAutomation ? theme.lift : theme.surfaceRaised,
              transition: "background 0.2s ease",
            }}>
            <div style={{
              position: "absolute", top: 3, left: settings.activityFullAutomation ? 21 : 3,
              width: 20, height: 20, borderRadius: 2, background: "#F5F5F3",
              transition: "left 0.2s ease",
            }} />
          </button>
        </div>
      </Card>

      <SettingsSectionLabel>{en("알림 & 피드백", "Notifications & Feedback")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>{en("촉각 피드백", "Haptic Feedback")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: theme.text }}>{t("탭할 때 살짝 진동", "Vibrate lightly on tap")}</span>
          <button
            onClick={() => {
              const next = !settings.hapticsEnabled;
              setHapticsEnabled(next);
              onSaveSettings({ ...settings, hapticsEnabled: next });
            }}
            style={{
              width: 44, height: 26, borderRadius: 2, border: "none", cursor: "pointer", position: "relative",
              background: settings.hapticsEnabled ? theme.lift : theme.surfaceRaised,
              transition: "background 0.2s ease",
            }}>
            <div style={{
              position: "absolute", top: 3, left: settings.hapticsEnabled ? 21 : 3,
              width: 20, height: 20, borderRadius: 2, background: "#F5F5F3",
              transition: "left 0.2s ease",
            }} />
          </button>
        </div>
      </Card>

      <Card>
        <SectionTitle>{en("매일 알림", "Daily Reminder")}</SectionTitle>
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
              width: 44, height: 26, borderRadius: 2, border: "none", cursor: "pointer", position: "relative",
              background: settings.dailyReminderEnabled ? theme.lift : theme.surfaceRaised,
              transition: "background 0.2s ease",
            }}>
            <div style={{
              position: "absolute", top: 3, left: settings.dailyReminderEnabled ? 21 : 3,
              width: 20, height: 20, borderRadius: 2, background: "#F5F5F3",
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

      <SettingsSectionLabel>{en("데이터", "Data")}</SettingsSectionLabel>
      <Card>
        <SectionTitle>{t("백업 & 복원", "Backup & Restore")}</SectionTitle>
        <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 12, lineHeight: 1.5 }}>
          {t(
            "앱 데이터는 이 기기 안에만 저장됩니다. 앱 삭제나 재설치 전에 JSON 백업을 먼저 내보내세요.",
            "Your app data is stored only on this device. Export a JSON backup before deleting or reinstalling the app."
          )}
        </div>
        <input
          ref={backupFileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={importJsonBackup}
          style={{ display: "none" }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            onClick={exportJsonBackup}
            style={{
              padding: "11px 12px", borderRadius: 2, border: `1px solid ${theme.lift}`,
              background: tint(theme.lift, 0.14), color: theme.text, fontSize: 13,
              fontWeight: 750, cursor: "pointer", fontFamily: MONO_FONT_STACK,
              letterSpacing: "0.04em", textTransform: "uppercase",
            }}
          >
            {t("JSON 내보내기", "Export JSON")}
          </button>
          <button
            onClick={() => backupFileInputRef.current?.click()}
            style={{
              padding: "11px 12px", borderRadius: 2, border: `1px solid ${theme.border}`,
              background: "transparent", color: theme.text, fontSize: 13,
              fontWeight: 700, cursor: "pointer", fontFamily: MONO_FONT_STACK,
              letterSpacing: "0.04em", textTransform: "uppercase",
            }}
          >
            {t("JSON 가져오기", "Import JSON")}
          </button>
        </div>
        <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 10, lineHeight: 1.5 }}>
          {t(
            "복원은 현재 데이터를 덮어씁니다. 중요한 변경 전에는 먼저 내보내기를 해두세요.",
            "Restore replaces current data. Export first before major changes."
          )}
        </div>
        {backupText && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: theme.text, fontWeight: 750, marginBottom: 6 }}>
              {t("백업 JSON 생성됨", "Backup JSON ready")}
            </div>
            <div style={{ fontSize: 11, color: theme.textFaint, lineHeight: 1.45, marginBottom: 8 }}>
              {t(
                "파일 저장 창이 안 뜨면 아래 내용을 복사해서 메모장에 .json 파일로 저장하세요.",
                "If the file save sheet did not appear, copy the text below and save it as a .json file."
              )}
            </div>
            <textarea
              readOnly
              value={backupText}
              onFocus={(e) => e.target.select()}
              style={{
                ...getInputStyle(theme),
                minHeight: 120,
                resize: "vertical",
                fontSize: 10.5,
                fontFamily: MONO_FONT_STACK,
                lineHeight: 1.35,
                whiteSpace: "pre",
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <button
                onClick={async () => {
                  const ok = await copyTextToClipboard(backupText);
                  window.alert(ok ? t("백업 JSON을 클립보드에 복사했습니다.", "Backup JSON copied to clipboard.") : t("자동 복사 실패. 텍스트를 길게 눌러 직접 복사해주세요.", "Auto-copy failed. Long-press the text and copy it manually."));
                }}
                style={{ padding: "9px 10px", borderRadius: 2, border: `1px solid ${theme.lift}`, background: tint(theme.lift, 0.14), color: theme.text, fontSize: 12.5, fontWeight: 750, cursor: "pointer" }}
              >
                {t("복사", "Copy")}
              </button>
              <button
                onClick={() => { setBackupText(""); setBackupFilename(""); }}
                style={{ padding: "9px 10px", borderRadius: 2, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, fontSize: 12.5, fontWeight: 650, cursor: "pointer" }}
              >
                {t("닫기", "Close")}
              </button>
            </div>
            {backupFilename && (
              <div style={{ fontSize: 10.5, color: theme.textFaint, marginTop: 7, fontFamily: MONO_FONT_STACK }}>
                {backupFilename}
              </div>
            )}
          </div>
        )}
      </Card>

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
              style={{ flex: 1, padding: 8, borderRadius: 2, fontSize: 12.5, border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, cursor: "pointer" }}>
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
        <SectionTitle>{en("앱 소개", "App Intro")}</SectionTitle>
        <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 10, lineHeight: 1.5 }}>
          {t("처음 설치할 때 봤던 기능 소개를 다시 볼 수 있어요.", "Watch the feature walkthrough you saw on first install again.")}
        </div>
        <button onClick={onShowIntro}
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 2, border: `1px solid ${theme.border}`,
            background: "none", color: theme.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
          {t("설명 다시 보기", "View intro again")}
        </button>
      </Card>

      <Card>
        <SectionTitle>{en("정보", "About")}</SectionTitle>
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
  const { t, en } = useLang();
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
                    flex: 1, padding: 9, borderRadius: 2, fontSize: 12.5, cursor: "pointer",
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
                    flex: 1, padding: "8px 2px", borderRadius: 2, fontSize: 12, cursor: "pointer",
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
              width: i === step ? 18 : 6, height: 6, borderRadius: 999,
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
  const { t, en } = useLang();
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
          background: theme.darkPanel || theme.surface, border: `1px solid ${theme.border}`, borderRadius: 2, padding: 20,
          maxWidth: 360, width: "100%", boxSizing: "border-box",
          boxShadow: "0 18px 44px rgba(0,0,0,0.36)", fontFamily: BODY_FONT_STACK,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 18, lineHeight: 1.5, whiteSpace: "pre-line" }}>{message}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {!hideCancel && (
            <button data-confirm-cancel="true" onClick={onCancel} style={{
              flex: 1, minHeight: 46, padding: 11, borderRadius: 2, border: `1px solid ${theme.border}`,
              background: "transparent", color: theme.textDim, cursor: "pointer", fontSize: 13, fontWeight: 700,
            }}>
              {cancelLabel || t("취소", "Cancel")}
            </button>
          )}
          <button onClick={onConfirm} style={{
            flex: 1, minHeight: 46, padding: 11, borderRadius: 2, border: "none",
            background: tone === "danger" ? theme.danger : theme.lift, color: tone === "danger" ? "#FBFAF2" : theme.heroText, cursor: "pointer", fontSize: 13, fontWeight: 800,
          }}>
            {confirmLabel || t("삭제", "Delete")}
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}

// While an edit modal is open, lock scrolling on all tab panels (the elements
// that actually scroll — body is overflow:hidden). The modal itself is
// portaled to <body> so it escapes the slide container's transform (a
// transformed ancestor would otherwise offset its position:fixed).
function useEditModalScrollLock(locked) {
  useEffect(() => {
    if (!locked) return;
    const panels = Array.from(document.querySelectorAll("[data-tab-id]"));
    const restore = panels.map((el) => ({ el, overflowY: el.style.overflowY, touchAction: el.style.touchAction }));
    panels.forEach((el) => { el.style.overflowY = "hidden"; el.style.touchAction = "none"; });
    return () => { restore.forEach(({ el, overflowY, touchAction }) => { el.style.overflowY = overflowY; el.style.touchAction = touchAction; }); };
  }, [locked]);
}
function EditModalBackdrop({ onClose }) {
  const stopScroll = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      role="presentation"
      onClick={onClose}
      onWheel={stopScroll}
      onTouchMove={stopScroll}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,0.50)",
        backdropFilter: "blur(2px)",
        touchAction: "none",
        overscrollBehavior: "none",
        animation: "hlFadeIn 0.22s ease",
      }}
    />
  );
}
function editModalCardStyle(theme) {
  return {
    position: "fixed",
    zIndex: 100,
    left: 10,
    right: 10,
    top: "max(54px, calc(env(safe-area-inset-top) + 40px))",
    bottom: "max(54px, calc(env(safe-area-inset-bottom) + 40px))",
    width: "auto",
    maxWidth: "min(500px, calc(100vw - 20px))",
    maxHeight: "calc(var(--app-viewport-height, 100vh) - 108px)",
    minWidth: 0,
    minHeight: 0,
    margin: "0 auto",
    overflowY: "auto",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
    boxSizing: "border-box",
    boxShadow: "0 20px 50px rgba(0,0,0,0.40)",
    borderColor: theme.lift,
    animation: "hlModalIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
  };
}

// Staggered entrance for list items — each item fades/slides in slightly after
// the previous, capped so long lists don't feel slow. Uses `both` fill so items
// start hidden before their delay.
function staggerStyle(i, per = 0.045, max = 8) {
  return { animation: "hlViewIn 0.32s cubic-bezier(0.22, 1, 0.36, 1) both", animationDelay: `${Math.min(i, max) * per}s` };
}
function EmptyState({ text, icon: Icon, actionLabel, onAction }) {
  const theme = useTheme();
  return (
    <div style={{ textAlign: "center", padding: "28px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {Icon && (
        <div style={{
          width: 42, height: 42, borderRadius: 2, border: `1px solid ${theme.border}`, background: "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={20} color={theme.textFaint} />
        </div>
      )}
      <div style={{ color: theme.textDim, fontSize: 14, lineHeight: 1.55, maxWidth: 280 }}>{text}</div>
      {actionLabel && onAction && (
        <button onClick={onAction} style={{
          background: "none", border: `1px solid ${theme.lift}`, color: theme.lift,
          borderRadius: 2, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 2,
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
  const [showStartupPatchNotes, setShowStartupPatchNotes] = useState(false);
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
    return Math.ceil(window.visualViewport?.height || window.innerHeight || 0) || null;
  });

  useEffect(() => {
    const updateViewportHeight = () => {
      const h = Math.ceil(window.visualViewport?.height || window.innerHeight || 0) || null;
      if (h) {
        setViewportHeight(h);
        document.documentElement.style.setProperty("--app-viewport-height", `${h}px`);
        document.documentElement.style.setProperty("--app-safe-top", "env(safe-area-inset-top, 0px)");
        document.documentElement.style.setProperty("--app-safe-bottom", "env(safe-area-inset-bottom, 0px)");
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
      setSettings(migratedSettings); setBodycompState((b || []).map(migrateBodyEntry)); setWorkoutsState((w || []).map(migrateWorkoutEntry)); setNutritionState((n || []).map(migrateNutritionEntry)); setTdeeHistoryState(t); setCustomFoodsState(cf); setProgramsState(migratePrograms(pr)); setWeekPlanState(wp); setDayLogsState(dl);
      setDevDateOffsetDays(s.devDateOffsetDays || 0);
      setHapticsEnabled(s.hapticsEnabled !== false);
      setLoaded(true);
      try {
        if (WEB_BUILD && window.localStorage?.getItem(PATCH_NOTES_SEEN_KEY) !== "1") {
          setShowStartupPatchNotes(true);
        }
      } catch (e) {
        if (WEB_BUILD) setShowStartupPatchNotes(true);
      }
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

  const markPatchNotesSeen = useCallback(() => {
    try {
      window.localStorage?.setItem(PATCH_NOTES_SEEN_KEY, "1");
    } catch (e) {
      // ignore localStorage errors
    }
    setShowStartupPatchNotes(false);
  }, []);

  const openPatchNotesFromStartup = useCallback(() => {
    try {
      window.localStorage?.setItem(PATCH_NOTES_SEEN_KEY, "1");
    } catch (e) {
      // ignore localStorage errors
    }
    window.location.href = PATCH_NOTES_URL;
  }, []);


  useEffect(() => {
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
        @media (max-height: 780px) { .today-compact { gap: 9px !important; } .today-compact button { min-height: 0; } }
        .edit-compact-modal { padding-top: 10px !important; padding-bottom: 8px !important; }
        .edit-compact-modal label { gap: 2px !important; font-size: 10.5px !important; }
        .edit-compact-modal input, .edit-compact-modal textarea { padding: 7px 9px !important; min-height: 34px !important; font-size: 12.5px !important; }
        .edit-compact-modal button { min-height: 34px !important; font-size: 12px !important; }
        .edit-compact-modal textarea { min-height: 34px !important; max-height: 54px !important; }
        @keyframes hlSkeletonPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @keyframes hlFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes hlModalIn { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes hlSheetIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes hlViewIn { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
        button { transition: transform 0.13s ease, opacity 0.13s ease; }
        button:not([disabled]):active { transform: scale(0.97); opacity: 0.6; }
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
  useEffect(() => {
    if (!loaded || WEB_BUILD) return;
    let mounted = true;
    (async () => {
      try {
        await getTodaySteps(); // ensures yesterday gets archived into history if the day just rolled over
        const avg = await getRecentAvgSteps();
        if (mounted) setRecentAvgSteps(avg);
      } catch (e) {
        // ignore — not running on a native platform
      }
    })();
    return () => { mounted = false; };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || WEB_BUILD) return;
    let mounted = true;
    let interval;
    const refresh = async () => {
      const result = await getTodaySteps();
      if (mounted && result && result.steps != null) setCurrentSteps(result.steps);
    };
    refresh();
    interval = setInterval(refresh, 10000);
    return () => { mounted = false; if (interval) clearInterval(interval); };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !settings?.cheatDayActive || settings.cheatDayUsedDate !== todayStr()) return undefined;
    const { weight, bodyfat } = getLatestBodyComp(bodycomp, settings);
    const engine = estimateTdeeEngine(settings, bodycomp, nutrition, workouts, weight, recentAvgSteps);
    const effectiveTdee = targetTdee(settings, engine);
    const baseTarget = computeActiveTarget(settings, effectiveTdee, weight, bodyfat, engine?.bmr);
    if (!baseTarget?.target) return undefined;
    const now = nowDate();
    const end = nowDate();
    end.setHours(23, 59, 0, 0);
    const delay = Math.max(1000, end.getTime() - now.getTime());
    const timer = setTimeout(() => {
      if (shouldReclaimUnusedCheatDay(settings, nutrition, baseTarget.target, todayStr())) {
        saveSettings(reclaimCheatDaySettings(settings));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [loaded, settings, bodycomp, nutrition, workouts, recentAvgSteps, saveSettings]);

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
  const [scrolled, setScrolled] = useState(false);
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
  const trackInnerRef = useRef(null);
  const dragVisualRef = useRef(0);
  const dragRafRef = useRef(0);
  const suppressClickRef = useRef(false);
  const dragScrollTopRef = useRef(0);
  const dragLockedSlideRef = useRef(null);
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
    setScrolled(!!el && el.scrollTop > 4);
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

  const unlockHorizontalSwipeScroll = () => {
    const slide = dragLockedSlideRef.current;
    if (slide) {
      slide.style.overflowY = slide.dataset.tabId === "today" ? "hidden" : "auto";
      slide.style.touchAction = "pan-y";
    }
    dragLockedSlideRef.current = null;
  };
  const lockHorizontalSwipeScroll = () => {
    const slide = slideRefs.current[tab];
    if (!slide) return;
    dragLockedSlideRef.current = slide;
    dragScrollTopRef.current = slide.scrollTop || 0;
    slide.style.overflowY = "hidden";
    slide.style.touchAction = "none";
  };
  const keepHorizontalSwipeScrollLocked = () => {
    const slide = dragLockedSlideRef.current;
    if (slide && Math.abs((slide.scrollTop || 0) - dragScrollTopRef.current) > 0.5) slide.scrollTop = dragScrollTopRef.current;
  };
  const resetSwipeGesture = () => {
    if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current);
    dragRafRef.current = 0;
    unlockHorizontalSwipeScroll();
    dragStartRef.current = null;
    draggingRef.current = false;
    dragVisualRef.current = 0;
    setLive(false);
    setDragPx(0);
    if (trackInnerRef.current) trackInnerRef.current.style.transform = `translate3d(${-tabIndex * trackWidth}px,0,0)`;
    setTimeout(() => { suppressClickRef.current = false; }, 80);
  };

  const handleTouchStart = (e) => {
    const locked = e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true'], [data-no-tab-swipe='true'], [role='dialog'], [role='menu']");
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
        suppressClickRef.current = true;
        lockHorizontalSwipeScroll();
        setLive(true);
      } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.1) {
        unlockHorizontalSwipeScroll();
        dragStartRef.current = null; // decisively vertical — let the page scroll normally
        return;
      } else {
        return; // still ambiguous — wait for a clearer read before deciding either way
      }
    }
    e.preventDefault(); // once claimed, stop vertical drift and descendant taps
    keepHorizontalSwipeScrollLocked();
    let clamped = dx;
    if (tabIndex === 0 && dx > 0) clamped = dx * 0.35; // rubber-band at the edges
    if (tabIndex === tabs.length - 1 && dx < 0) clamped = dx * 0.35;
    dragVisualRef.current = clamped;
    if (!dragRafRef.current) dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = 0;
      if (trackInnerRef.current) trackInnerRef.current.style.transform = `translate3d(${-tabIndex * trackWidth + dragVisualRef.current}px,0,0)`;
    });
  };
  const handleTouchEnd = () => {
    if (!draggingRef.current) { dragStartRef.current = null; return; }
    // A quick short flick completes the swipe too — doesn't need to cross
    // the full drag-distance threshold, just needs to be fast.
    const elapsed = Date.now() - (dragStartRef.current?.time || Date.now());
    const isFlick = elapsed < 250 && Math.abs(dragVisualRef.current) > 36;
    const threshold = isFlick ? 42 : trackWidth * 0.25;
    setLive(false);
    if (dragVisualRef.current <= -threshold && tabIndex < tabs.length - 1) {
      setTab(tabs[tabIndex + 1].id);
    } else if (dragVisualRef.current >= threshold && tabIndex > 0) {
      setTab(tabs[tabIndex - 1].id);
    }
    setDragPx(0);
    dragVisualRef.current = 0;
    if (trackInnerRef.current) trackInnerRef.current.style.transform = `translate3d(${-tabIndex * trackWidth}px,0,0)`;
    setTimeout(() => { suppressClickRef.current = false; }, 80);
    dragStartRef.current = null;
    draggingRef.current = false;
    unlockHorizontalSwipeScroll();
  };
  const handleTouchCancel = () => resetSwipeGesture();

  if (!loaded) {
    const pulse = (h, w = "100%") => (
      <div style={{
        height: h, width: w, borderRadius: 2, background: theme.darkPanel2 || theme.surfaceRaised,
        animation: "hlSkeletonPulse 1.4s ease-in-out infinite",
      }} />
    );
    return (
      <div style={{ background: theme.bg, minHeight: "100dvh", height: "var(--app-viewport-height, 100dvh)", fontFamily: BODY_FONT_STACK, padding: "calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px))", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14 }}>
        <style>{`@media (max-height: 780px) { .today-compact { gap: 9px !important; } .today-compact button { min-height: 0; } }
        @keyframes hlSkeletonPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }`}</style>
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
    <style>{`
      html, body, #root { min-height: 100%; background: ${theme.bg}; overscroll-behavior: none; }
      body { margin: 0; overflow: hidden; }
      @supports (height: 100dvh) {
        html, body, #root { min-height: 100dvh; }
      }
      @media (display-mode: standalone) {
        body { background: ${theme.bg}; }
      }
      .today-compact { overflow: hidden; }
      .today-compact button { min-height: 0; }
      @media (max-height: 860px) {
        .today-compact { gap: 9px !important; }
        .today-meters { gap: 12px !important; }
        .today-session > div, .today-session > button { padding-top: 11px !important; padding-bottom: 11px !important; }
        .today-indicators button { padding-top: 9px !important; padding-bottom: 9px !important; }
        .today-checklist button { padding-top: 9px !important; padding-bottom: 9px !important; }
      }
      @media (max-height: 760px) {
        .today-compact { gap: 6px !important; }
        .today-header [style*="margin-top: 7px"] { display: none !important; }
        .today-meters { gap: 8px !important; }
        .today-meters button > div:nth-child(1) { margin-bottom: 5px !important; }
        .today-meters button > div:nth-child(2) { margin-bottom: 7px !important; }
        .today-meters button > div:nth-child(2) > span:first-child { font-size: 29px !important; }
        .today-session > div, .today-session > button { padding-top: 8px !important; padding-bottom: 8px !important; }
        .today-session [style*="font-size: 22px"] { font-size: 19px !important; }
        .today-indicators button { padding-top: 7px !important; padding-bottom: 7px !important; }
        .today-indicators [style*="margin-bottom: 7px"] { margin-bottom: 4px !important; }
        .today-checklist button { padding-top: 7px !important; padding-bottom: 7px !important; }
      }
      @media (max-height: 680px) {
        .today-header { display: none; }
        .today-compact { gap: 5px !important; }
        .today-meters { gap: 7px !important; }
        .today-checklist button { padding-top: 6px !important; padding-bottom: 6px !important; }
      }
    `}</style>
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
      minHeight: "100dvh", height: "var(--app-viewport-height, 100dvh)", overflow: "hidden", color: theme.text,
      fontFamily: BODY_FONT_STACK, fontWeight: 500,
      display: "flex", flexDirection: "column", position: "relative",
      paddingTop: "env(safe-area-inset-top, 0px)",
      boxSizing: "border-box",
    }}>
      <div style={{ position: "relative", minHeight: 58, padding: "8px 52px 8px 16px", textAlign: "left", background: theme.bg, backdropFilter: "blur(10px)", borderBottom: `1px solid ${theme.border}`, boxShadow: scrolled ? "0 4px 14px rgba(0,0,0,0.07)" : "none", transition: "box-shadow 0.22s ease", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "flex-start", overflow: "visible", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: theme.lift, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 6px 16px ${tint(theme.lift, 0.28)}` }}>
            <svg width="20" height="20" viewBox="0 0 512 512" aria-hidden="true">
              <g fill={theme.isDark ? "#0A0A0A" : "#0A0A0A"}>
                <rect x="168" y="150" width="38" height="212" rx="14" />
                <rect x="306" y="150" width="38" height="212" rx="14" />
                <rect x="168" y="237" width="176" height="38" rx="10" />
                <rect x="128" y="192" width="28" height="128" rx="12" />
                <rect x="356" y="192" width="28" height="128" rx="12" />
              </g>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 18, lineHeight: 1.0, fontWeight: 600, fontStyle: "italic", letterSpacing: "-0.01em", fontFamily: SERIF_FONT_STACK, color: theme.text }}>Hybrid Log</div>
            {(() => {
              const now = nowDate();
              const dayN = settings.startDate ? Math.max(0, Math.round((now - parseLocalDate(settings.startDate)) / 86400000)) : null;
              const wd = ["SUN","MON","TUE","WED","THU","FRI","SAT"][now.getDay()];
              const mo = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][now.getMonth()];
              const dd = String(now.getDate()).padStart(2, "0");
              return (
                <div style={{ fontSize: 9.5, letterSpacing: "0.16em", fontFamily: MONO_FONT_STACK, color: theme.textFaint, marginTop: 3, fontWeight: 500 }}>
                  {dayN != null ? `DAY ${dayN} · ` : ""}{wd} {dd} {mo}
                </div>
              );
            })()}
          </div>
        </div>
        <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 2 }}>
          {showScrollTop && tab !== "today" && (
            <button
              onClick={scrollActiveTabToTop}
              aria-label="Scroll to top"
              title={t("상단으로", "Back to top")}
              style={{ width: 36, height: 36, padding: 0, borderRadius: 2, cursor: "pointer", background: "transparent", border: "none", color: theme.textDim, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <ChevronUp size={16} />
            </button>
          )}
          <button
            onClick={() => setShowSettingsSheet(true)}
            aria-label="Settings"
            title={t("설정", "Settings")}
            style={{ width: 36, height: 36, padding: 0, borderRadius: 2, cursor: "pointer", background: "transparent", border: "none", color: theme.textDim, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </div>

      {err && (
        <div style={{ margin: "8px 16px 0", background: tint(theme.danger, 0.14), border: `1px solid ${theme.danger}`, borderRadius: 2, padding: "8px 12px", fontSize: 12, color: theme.danger, display: "flex", justifyContent: "space-between" }}>
          {err}
          <button onClick={() => setErr(null)} style={{ background: "none", border: "none", color: theme.danger, cursor: "pointer" }}><X size={13} /></button>
        </div>
      )}

      <div
        ref={trackWrapRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClickCapture={(e) => { if (suppressClickRef.current) { e.preventDefault(); e.stopPropagation(); } }}
        style={{ flex: 1, overflow: "hidden", maxWidth: 520, width: "100%", margin: "0 auto", position: "relative", touchAction: "pan-y" }}
      >
        <div style={{
          display: "flex",
          height: "100%",
          width: trackWidth * tabs.length,
          transform: `translate3d(${-tabIndex * trackWidth + dragPx}px, 0, 0)`,
          willChange: "transform",
          transition: live ? "none" : "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
        }}>
          {tabs.map((tb) => (
            <div key={tb.id}
              data-tab-id={tb.id}
              ref={(el) => { slideRefs.current[tb.id] = el; }}
              onScroll={(e) => { if (tb.id === tab) { setScrolled(e.currentTarget.scrollTop > 4); if (tb.id !== "today") setShowScrollTop(e.currentTarget.scrollTop > 150); } }}
              style={{
                width: trackWidth,
                flexShrink: 0,
                height: "100%",
                overflowY: tb.id === "today" ? "hidden" : "auto",
                boxSizing: "border-box",
                padding: tb.id === "today" ? "10px 16px" : 16,
                paddingBottom: tb.id === "today" ? "calc(78px + env(safe-area-inset-bottom))" : "calc(120px + env(safe-area-inset-bottom))",
                scrollPaddingBottom: tb.id === "today" ? 0 : 180,
                overscrollBehavior: "contain",
                touchAction: "pan-y",
              }}>
              {tb.id === "today" && <TodayTab settings={settings} bodycomp={bodycomp} recentAvgSteps={recentAvgSteps} currentSteps={currentSteps} goToTab={goToTab} openActView={openActView} workouts={workouts} nutrition={nutrition} dayLogs={dayLogs} setDayLogs={setDayLogs} weekPlan={weekPlan} programs={programs} />}
              {tb.id === "act" && <ActTab isActive={tb.id === tab} workouts={workouts} setWorkouts={setWorkouts} programs={programs} weekPlan={weekPlan} bodycomp={bodycomp} setBodycomp={setBodycomp} dayLogs={dayLogs} setDayLogs={setDayLogs} initialView={actInitialView} onConsumedInitialView={() => setActInitialView(null)} resetSignal={actResetSignal} onViewChange={setActCurrentView} currentSteps={currentSteps} />}
              {tb.id === "eat" && <NutritionTab isActive={tb.id === tab} settings={settings} onSaveSettings={saveSettings} bodycomp={bodycomp} workouts={workouts} nutrition={nutrition} setNutrition={setNutrition} customFoods={customFoods} setCustomFoods={setCustomFoods} recentAvgSteps={recentAvgSteps} resetSignal={eatResetSignal} />}
              {tb.id === "plan" && <PlanTab settings={settings} onSaveSettings={saveSettings} bodycomp={bodycomp} nutrition={nutrition} workouts={workouts} programs={programs} weekPlan={weekPlan} setWeekPlan={setWeekPlan} setPrograms={setPrograms} recentAvgSteps={recentAvgSteps} tdeeHistory={tdeeHistory} setTdeeHistory={setTdeeHistory} resetSignal={planResetSignal} />}
              {tb.id === "progress" && <ProgressTab settings={settings} onSaveSettings={saveSettings} bodycomp={bodycomp} setBodycomp={setBodycomp} nutrition={nutrition} workouts={workouts} weekPlan={weekPlan} tdeeHistory={tdeeHistory} setTdeeHistory={setTdeeHistory} recentAvgSteps={recentAvgSteps} />}
            </div>
          ))}
        </div>
      </div>

      <SettingsSheet open={showSettingsSheet} onClose={() => setShowSettingsSheet(false)}>
        <SettingsTab settings={settings} onSaveSettings={saveSettings} workouts={workouts} nutrition={nutrition} bodycomp={bodycomp} programs={programs} onShowIntro={() => setShowIntroAgain(true)} />
      </SettingsSheet>

      <PatchNotesStartupModal
        open={showStartupPatchNotes}
        onDismiss={markPatchNotesSeen}
        onOpenNotes={openPatchNotesFromStartup}
      />

      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: `linear-gradient(180deg, ${tint(theme.bg, 0.92)}, ${theme.bg})`, backdropFilter: "blur(14px)", borderTop: `1px solid ${theme.border}`,
        display: "flex", justifyContent: "center",
        boxShadow: "0 -12px 28px rgba(0,0,0,0.28)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 520, padding: "0 6px" }}>
          {tabs.map((tabItem) => {
            const Icon = tabItem.icon;
            const active = tab === tabItem.id;
            return (
              <button key={tabItem.id} onClick={() => goToTab(tabItem.id, { reset: ["act", "eat", "plan"].includes(tabItem.id) })}
                style={{
                  flex: 1, background: "transparent", border: "none", padding: "10px 4px 11px",
                  position: "relative",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                  color: active ? theme.lift : theme.textFaint, cursor: "pointer",
                }}>
                <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: active ? 22 : 0, height: 2, background: theme.lift, transition: "width 0.2s ease", borderRadius: 1 }} />
                <Icon size={17} strokeWidth={active ? 2.4 : 1.8} style={{ animation: active ? "hlTabBounce 0.35s ease" : "none" }} />
                <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: MONO_FONT_STACK }}>{tabItem.label}</span>
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

# Hybrid Log — Android App (Capacitor)

리프팅 · 러닝 · 식단 · 체성분 · 유지칼로리 트래커.
`android/` 폴더에 실제 안드로이드 프로젝트(Capacitor)가 준비되어 있어서
**Android Studio로 열어서 빌드 버튼만 누르면 APK가 나옵니다.**

데이터는 서버로 전송되지 않고 폰 안(WebView의 localStorage)에만 저장됩니다.

> 이 프로젝트는 이 샌드박스 환경(Android SDK/Gradle/에뮬레이터가 없음)에서는
> 실제 APK 컴파일까지는 못 돌려봤어요 — Gradle이 Android SDK와 Google
> Maven 저장소에서 빌드 툴체인을 받아와야 하는데, 여기선 네트워크가 npm
> 레지스트리 등으로 제한돼 있어서 안 됩니다. 대신 프로젝트 구조·아이콘·
> 스플래시 화면까지 전부 준비해뒀으니, 아래 단계는 실제 Android Studio에서
> 몇 번 눌러서 진행하면 바로 됩니다.

Capacitor는 최신(8.x)이 아니라 **6.x로 버전을 고정**해뒀어요. 8.x는 너무
최신 AGP(8.13)/Gradle(8.14) 조합을 요구해서 `:capacitor-android` 모듈이
제대로 설정되지 않는 문제가 있었습니다 (`No matching variant ... No
variants exist` 에러). 6.x는 AGP 8.2.1 / Gradle 8.2.1로, 현재 나와있는
대부분의 Android Studio 버전과 무난하게 맞습니다.

## 빌드 전 확인사항

- **JDK 17 필요**: AGP 8.x는 JDK 17 이상을 요구합니다. Android Studio를
  최근 버전(Hedgehog 이상)으로 쓰고 있다면 내장 JDK가 이미 17+라 별도
  설정 없이 됩니다. Android Studio의 Gradle 설정에서 JDK가 이상하게 잡혀
  있다면 **File → Settings → Build Tools → Gradle → Gradle JDK**에서
  "Embedded JDK"로 맞춰주세요.
- Gradle 동기화 중 "Android Gradle Plugin 업데이트 권장" 팝업이 뜨면
  **무시하거나 "Don't remind me"**를 눌러주세요 — 지금 버전 조합이 이미
  검증된 조합이라 굳이 올릴 필요 없습니다.

## 준비물

- [Android Studio](https://developer.android.com/studio) 설치 (SDK, Gradle 자동으로 같이 깔림)
- Node.js (이미 있다면 패스)

## 1. 웹 코드를 수정했다면 다시 빌드 + 동기화

앱 로직(`src/App.jsx`)을 고칠 때마다 이 두 명령을 실행해서 안드로이드
프로젝트에 최신 코드를 반영해야 합니다.

```bash
npm install
npm run build
npx cap sync android
```

## 2. Android Studio에서 APK 만들기

1. Android Studio 실행 → **Open** → 이 프로젝트의 `android` 폴더 선택
2. 처음 열면 Gradle 동기화가 자동으로 시작됨 (몇 분 걸릴 수 있음, 인터넷 필요)
3. 상단 메뉴 **Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. 빌드 끝나면 우측 하단에 뜨는 **"locate"** 링크 클릭 → APK 위치:
   `android/app/build/outputs/apk/debug/app-debug.apk`
5. 이 APK 파일을 폰으로 옮겨서 설치 (출처를 알 수 없는 앱 설치 허용 필요)

### 폰 연결해서 바로 실행하고 싶으면
USB로 폰 연결 + 개발자 모드/USB 디버깅 켠 다음, Android Studio 상단
재생▶ 버튼 누르면 바로 폰에 설치되고 실행됨.

### 커맨드라인으로 빌드하고 싶으면 (Android Studio 없이)
Android SDK가 이미 설치되어 있다면:
```bash
cd android
./gradlew assembleDebug
```
결과물은 동일하게 `app/build/outputs/apk/debug/app-debug.apk`.

## 3. Play스토어에 올리고 싶다면

- 정식 배포용 서명키를 만들고 (`keytool`) `assembleRelease`로 릴리즈 빌드
- Android Studio의 **Build → Generate Signed Bundle / APK** 메뉴가 이 과정을 안내해줌
- 자세한 건 필요할 때 다시 물어봐줘, 그때 단계별로 도와줄게

## 파일 구조

```
src/App.jsx              앱 전체 로직/화면
src/storagePolyfill.js   window.storage → localStorage 변환 레이어
src/main.jsx             진입점
public/icon-*.png        PWA용 아이콘
android/                 Capacitor로 생성된 실제 안드로이드 프로젝트
  app/src/main/res/mipmap-*     런처 아이콘 (세이지/오트밀/앰버 테마 적용됨)
  app/src/main/res/drawable-*   스플래시 화면 (같은 테마)
capacitor.config.json    앱 ID, 이름, 웹 빌드 폴더 설정
vite.config.js           PWA 매니페스트 설정 (웹으로도 계속 쓸 수 있음)
```

## 앱 이름 / 패키지 ID 바꾸고 싶으면

`capacitor.config.json`의 `appId`(`com.hybridlog.app`)와 `appName`을 바꾸고
다시 `npx cap sync android` 실행. 이미 만들어진 `android` 폴더 안의 패키지
경로까지 통째로 바꾸려면 `npx cap sync` 후 Android Studio의 **Refactor →
Rename Package** 기능을 쓰는 게 제일 안전함.

## 나중에 데이터가 더 많아지면

`localStorage`는 용량이 작고(보통 5MB) 동기 방식이라 데이터가 아주 많아지면
느려질 수 있어요. 그럴 땐 `src/storagePolyfill.js` 안의 로직만
IndexedDB(`idb` 라이브러리 추천)로 바꾸면 나머지 코드는 손댈 필요 없습니다 —
`window.storage.get/set/delete/list` 인터페이스만 유지하면 됩니다.



## 0.13.3 fix pass

- Restored TDEE fallback calculation when age/height are incomplete.
- Separated cut-tier calorie targets and macros.
- Fixed macro progress bars to show consumed percentage and over-target state.
- Synced Nutrition to the effective/calibrated TDEE.
- Fixed latest same-day body measurement selection and chart deduplication.
- Fixed Today's Workout to open the scheduled weekly-plan program.
- Hardened manual-entry buttons against swipe/touch interference.
- Aligned calorie labels and removed unsupported water-tracking copy.

## 0.14.0 comprehensive workout UX patch

- Per-exercise warm-up set counts in the program editor.
- Dial-style weight/reps pickers, weight-first input order, and per-set target-rep override.
- Warm-up vs working-set metadata and corrected progressive-overload failure handling.
- Smooth requestAnimationFrame rest ring.
- Native Android foreground rest timer with ongoing countdown notification, Skip action, and four sound modes.
- More anatomical front/back muscle map.
- Workout edit auto-scroll, compact Today layout, step-goal success colour, session-complete state, and rest-day icon.
- One-use-per-week cheat-day toggle with weekly-budget-preserving targets.
- Card-level horizontal tab swiping with direct transform updates for smoother gestures.

## 0.14.1

- Added storage v5 migrations for programs, exercise IDs, warm-up sets, and set metadata.
- Fixed full reset to clear progressive overload, timer sound, and step history.
- Fixed weekly cheat-day usage so toggling it off cannot reset the weekly limit.
- Synced native rest-timer notification state with the in-app timer.
- Rest timer now persists its end time and can recover after service recreation.
- Separated rest-timer notification permission from activity-recognition permission.
- Fixed exercise history matching to prefer stable exercise IDs.
- Added progressive warm-up weight suggestions.
- Improved number wheels with current-value auto-scroll and quick +/- controls.
- Fixed working-set numbering when warm-up sets are present.
- Added touch-cancel cleanup and vertical-scroll locking during horizontal tab swipes.

## 0.14.2

- Fixed runtime crash caused by missing horizontal swipe lock refs.
- Added `dragScrollTopRef` and `dragLockedSlideRef` declarations.

## 0.14.3

- Changed Today into a fixed fullscreen dashboard with vertical scrolling disabled.
- Added height-responsive compact layouts for shorter phones.
- Kept horizontal tab swiping available on Today.
- Other tabs continue to use independent vertical scrolling.

## 0.14.7

- Minimum-intake floor notes now use the danger/warning color.
- Added a warning icon and stronger weight only when the intake floor is reached.
- Other safety-cap notes retain the neutral secondary style.

## 0.14.8

- Clean rebuild release to eliminate stale Android web assets.
- Verified horizontal swipe lock refs are declared.
- Android assets were regenerated from the current source.

## 0.14.9

- Added Settings → Data → Backup & Restore.
- Export JSON downloads a full local-data backup.
- Import JSON restores a previous backup after confirmation and reloads the app.
- Backup/reset key list now includes storageVersion.

## 0.14.10

- Fixed cheat-day toggle crash in Eat by passing onSaveSettings into NutritionTab.
- Reworked JSON export for Android WebView: share/download attempt plus visible JSON fallback and copy button.
- Import JSON remains file-based with confirmation and reload.

## 0.14.11

- Cheat-day target is now used consistently for Eat remaining-calorie display.
- Active cheat day is automatically reclaimed around 23:59 if normal calories were not exceeded.
- Turning off an active cheat day now fully restores the weekly cheat-day allowance.

## 0.14.12

- Fixed runtime TDZ error from the cheat-day auto-reclaim effect.
- Moved the app-level 23:59 reclaim watcher after recentAvgSteps is initialized.

## 0.14.13

- Nutrition entries now support meal categories: breakfast, lunch, dinner, snack, and other.
- Eat history groups items under meal categories instead of treating every item as a separate meal.
- Today meal count now counts used meal categories, while still showing item count.
- Food Calculator and Manual Entry both include a meal category selector.
- Storage migration v6 adds mealCategory to existing nutrition entries.

## 0.14.14

- Guided workout setup now remembers the last settings per program.
- Rest time, weight increment, rest sound, and target-rep overrides are restored next time the same guided program starts.
- Guide settings are stored inside progressiveOverload and included in JSON backups.

## 0.14.15

- Editing existing nutrition entries now opens as a modal popup instead of moving the user to an inline form.
- Editing existing workout entries now opens as a modal popup.
- Removed automatic scroll-to-top behavior for workout edits.

## 0.14.16

- Fixed edit modal layering bug where the blur backdrop covered the edit form.
- Edit backdrop now stays in the same stacking context as the edit card.
- Edit cards stop pointer events from bubbling to the backdrop.

## 0.14.18

- Reverted edit popup layout to the 0.14.16 style.
- Fixed horizontal clipping by constraining modal width to the viewport.
- Edit forms now use a single-column grid on small modal screens.
- Workout subtype buttons wrap in edit mode instead of overflowing.

## 0.14.19

- Kept the 0.14.18 edit popup design.
- Reduced popup vertical height by increasing top/bottom margins.
- Added a viewport-based maxHeight so content scrolls inside instead of clipping vertically.

## 0.14.20

- Made edit popups more compact so normal edits fit in one view without scrolling.
- Reduced modal height and input density while keeping the 0.14.18/0.14.19 visual style.
- Nutrition edit keeps a two-column compact grid.
- Workout edit hides detailed set editing behind a collapsed section so the main edit form fits at a glance.

## 0.14.21

- Fixed workout edit popup rendering separately from the animated-height container.
- Cardio workout edits now always show editable fields, even when older entries lack duration metadata.
- Added safer edit fallbacks for workout type/subtype and exercise loading.

## 0.14.22

- Workout edit modal no longer remains visible over other tabs.
- Act and Eat edit popups close when their tab becomes inactive.
- Edit popups now block background scroll, wheel, touchmove, and tab-swipe gestures.
- Edit cards are marked as dialogs/no-swipe zones and modal overflow is locked.

## 0.14.24

- Recent Activity items in Act now open the workout edit modal directly.
- Tapping a recent workout no longer navigates into the Training/Cardio start screen first.
- Added a modal-only WorkoutsTab path so direct edits can reuse the same save/delete/edit logic without rendering the full workout screen.

## 0.14.25

- Fixed stale Recent Activity edit requests reopening when entering Today's Session afterward.
- Act sub-screen navigation now clears any overview direct-edit workout id before rendering Training/Cardio.
- Returning from Act sub-screens also clears direct-edit state.

## 0.14.26

- Added Rest Day Credit without creating fake workout records.
- Home now shows Today's Recovery on planned rest days.
- Rest Day completion is stored on dayLogs as restCompleted and preserves normal check-in data.
- Consistency streak now counts planned workout completion plus rest-day confirmation/check-in.
- Workout streak remains separate and only counts actual lift/run workout days.
- Rest completion appears in Home checklist but does not show in Recent Activity as a workout.

## 0.14.40 Web

- Ported the Android 0.14.40 plan-edit crashfix codebase to the GitHub Pages web build.
- Uses `/hybrid-log/` Vite base for the project page.
- Hides Android-only automatic step counter UI and keeps TDEE activity level based on the manual Activity setting.
- Native Android folder is omitted from this web package.

## Latest Patch Notes

- [Hybrid Log 0.14.40 Patch Notes](./PATCH_NOTES_0.14.40.md)

## Latest Web Patch Notes

Try these after deploy:

- `https://sdajb.github.io/hybrid-log/patch-notes.html`
- `https://sdajb.github.io/hybrid-log/patch-notes-0.14.41.html`
- `https://sdajb.github.io/hybrid-log/patch-notes-0.14.41/`

Important: after the PWA shortcut fix, delete the old desktop/home-screen shortcut and create it again.

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


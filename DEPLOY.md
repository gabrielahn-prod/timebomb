# Vercel + Supabase 배포

이 프로젝트는 Vercel에 정적 프론트를 배포하고, 데이터 저장과 서버 전용 API 호출은 Supabase를 사용합니다.

## 1. Supabase 준비

Supabase CLI로 마이그레이션과 Edge Functions를 배포합니다.

```bash
supabase link --project-ref your-project-ref
supabase db push
supabase functions deploy schedules
supabase functions deploy place-search
supabase functions deploy route-estimate
supabase functions deploy admin-dashboard
```

Edge Function secrets를 설정합니다.

```bash
supabase secrets set KAKAO_REST_API_KEY=your_kakao_rest_api_key
supabase secrets set KAKAO_MOBILITY_REST_API_KEY=your_kakao_mobility_rest_api_key
supabase secrets set ODSAY_API_KEY=your_odsay_api_key
supabase secrets set ODSAY_REFERER=https://your-vercel-domain.vercel.app
supabase secrets set ADMIN_PASSWORD=change_this_admin_password
```

`SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Supabase Edge Functions에서 기본 제공됩니다.

## 2. Vercel 설정

Vercel 프로젝트의 Root Directory를 이 폴더로 지정합니다.

```text
timebomb/timebomb
```

Build 설정은 기본값을 사용합니다.

```text
Build Command: npm run build
Output Directory: dist
```

Vercel 환경 변수:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_KAKAO_MAP_APP_KEY=your_kakao_javascript_app_key
```

## 3. Kakao 설정

Kakao Developers의 JavaScript 허용 도메인에 Vercel 도메인을 추가합니다.

```text
https://your-vercel-domain.vercel.app
```

커스텀 도메인을 연결하면 그 도메인도 추가합니다.

## 4. 로컬 개발

`.env`에 아래 값을 넣고 실행합니다.

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=your_local_anon_key
VITE_KAKAO_MAP_APP_KEY=your_kakao_javascript_app_key
```

```bash
npm install
npm run dev
```

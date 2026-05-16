import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlarmClock,
  Bath,
  Bus,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  GripVertical,
  Home,
  ListChecks,
  LocateFixed,
  Menu,
  Plus,
  RotateCcw,
  Save,
  Search,
  Download,
  Share2,
  Sparkles,
  Smartphone,
  Train,
  Trash2,
  X,
} from 'lucide-react';
import './styles.css';

const ACTIVE_PROFILE_KEY = 'timebomb:active-profile-id:v1';
const DEVICE_ID_KEY = 'timebomb:device-id:v1';
const ADMIN_PASSWORD_SESSION_KEY = 'timebomb:admin-password:v1';
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const KAKAO_MAP_APP_KEY = import.meta.env.VITE_KAKAO_MAP_APP_KEY;

const routeModes = [
  { id: 'transit', label: '대중교통', icon: Train },
  { id: 'car', label: '차량', icon: Car },
];

const categories = [
  {
    id: 'wash',
    name: '씻기',
    icon: Bath,
    color: '#18a999',
    soft: '#d8f6f1',
    blocks: ['세안', '양치', '샤워'],
  },
  {
    id: 'ready',
    name: '준비',
    icon: Sparkles,
    color: '#e85d75',
    soft: '#ffe1e8',
    blocks: ['옷 고르기', '화장', '로션', '머리 말리기', '머리하기'],
  },
  {
    id: 'inside',
    name: '이동',
    icon: Home,
    color: '#f4a261',
    soft: '#ffefd9',
    blocks: ['엘리베이터', '계단', '현관까지 이동', '도보'],
  },
  {
    id: 'car',
    name: '차량',
    icon: Car,
    color: '#4b5563',
    soft: '#e5e7eb',
    blocks: ['차량으로 이동'],
  },
  {
    id: 'bus',
    name: '버스',
    icon: Bus,
    color: '#3f7cac',
    soft: '#dcecff',
    blocks: ['정류장까지 이동', '버스 평균 대기시간', '버스 시간표 맞추기', '버스 탑승 시간'],
  },
  {
    id: 'subway',
    name: '지하철',
    icon: Train,
    color: '#7b61ff',
    soft: '#ebe5ff',
    blocks: ['지하철 대기시간', '지하철 탑승 시간', '환승 시간', '역까지 이동'],
  },
];

const starterPlan = [
  makeBlock('wash', '세안', 3),
  makeBlock('wash', '양치', 3),
  makeBlock('ready', '옷 고르기', 7),
  makeBlock('inside', '엘리베이터', 4),
  makeBlock('bus', '버스 평균 대기시간', 8),
];

const defaultProfile = {
  id: 'commute',
  name: '출근',
  plan: starterPlan,
  targetTime: '09:00',
  bufferMinutes: 10,
};

function makeBlock(categoryId, label, minutes = 5) {
  return {
    id: `${categoryId}-${label}-${crypto.randomUUID()}`,
    categoryId,
    label,
    minutes,
  };
}

function getCategory(categoryId) {
  return categories.find((c) => c.id === categoryId) ?? categories[0];
}

function formatDuration(minutes) {
  const safe = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}분`;
  return `${h}시간 ${m}분`;
}

function normalizeMinutes(minutes, max = 999) {
  return Math.max(0, Math.min(max, Number(minutes) || 0));
}

function parseTimeToMinutes(time) {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

function formatClock(minutes) {
  const day = 24 * 60;
  const norm = ((minutes % day) + day) % day;
  const h = String(Math.floor(norm / 60)).padStart(2, '0');
  const m = String(norm % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create image'));
    }, 'image/png', 0.96);
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function categoryName(categoryId) {
  return categories.find((c) => c.id === categoryId)?.name ?? categoryId;
}

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = `device-${crypto.randomUUID().slice(0, 8)}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function makeProfile(name = '새 일정') {
  return {
    ...defaultProfile,
    id: `profile-${crypto.randomUUID().slice(0, 8)}`,
    name,
    plan: [],
    isNew: true,
  };
}

function normalizeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    plan: Array.isArray(profile.plan)
      ? profile.plan.map((block) => ({ ...block, minutes: normalizeMinutes(block.minutes) }))
      : [],
    targetTime: profile.target_time ?? profile.targetTime ?? '09:00',
    bufferMinutes: profile.buffer_minutes ?? profile.bufferMinutes ?? 10,
    isNew: false,
  };
}

function serializeProfile(profile) {
  return {
    name: profile.name || '새 일정',
    target_time: profile.targetTime || '09:00',
    buffer_minutes: normalizeMinutes(profile.bufferMinutes, 240),
    plan: Array.isArray(profile.plan)
      ? profile.plan.map((block) => ({ ...block, minutes: normalizeMinutes(block.minutes) }))
      : [],
  };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

let kakaoMapLoader;

function loadKakaoMapSdk() {
  if (!KAKAO_MAP_APP_KEY) {
    return Promise.reject(new Error('Kakao JavaScript key is not configured'));
  }
  if (window.kakao?.maps?.services) return Promise.resolve(window.kakao);
  if (kakaoMapLoader) return kakaoMapLoader;

  kakaoMapLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-kakao-map-sdk="true"]');
    if (existing) {
      existing.addEventListener('load', () => window.kakao.maps.load(() => resolve(window.kakao)));
      existing.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_APP_KEY}&libraries=services&autoload=false`;
    script.async = true;
    script.dataset.kakaoMapSdk = 'true';
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return kakaoMapLoader;
}

function KakaoPlacePickerMap({
  startPlace,
  endPlace,
  searchResults = [],
  searchResultTarget,
  searchQuery,
  routeMode,
  activePinTarget,
  onActivePinTargetChange,
  onSearchQueryChange,
  onSearch,
  onPickPlace,
}) {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const overlaysRef = useRef([]);
  const activePinTargetRef = useRef(activePinTarget);
  const [mapState, setMapState] = useState(KAKAO_MAP_APP_KEY ? 'loading' : 'missing-key');

  useEffect(() => {
    activePinTargetRef.current = activePinTarget;
  }, [activePinTarget]);

  useEffect(() => {
    let ignore = false;

    async function initializeMap() {
      try {
        const kakao = await loadKakaoMapSdk();
        if (ignore || !mapNodeRef.current) return;
        const center = new kakao.maps.LatLng(
          Number(startPlace?.lat) || Number(endPlace?.lat) || 37.5665,
          Number(startPlace?.lng) || Number(endPlace?.lng) || 126.978,
        );
        const map = new kakao.maps.Map(mapNodeRef.current, { center, level: 5 });
        mapRef.current = map;
        geocoderRef.current = new kakao.maps.services.Geocoder();
        kakao.maps.event.addListener(map, 'click', (mouseEvent) => {
          const latLng = mouseEvent.latLng;
          const target = activePinTargetRef.current;
          const picked = {
            id: `map-${target}-${Date.now()}`,
            name: target === 'start' ? '지도 선택 출발지' : '지도 선택 도착지',
            address: '',
            road_address: '',
            category: '지도 선택',
            lng: latLng.getLng(),
            lat: latLng.getLat(),
          };

          geocoderRef.current.coord2Address(latLng.getLng(), latLng.getLat(), (result, status) => {
            const kakaoStatus = window.kakao?.maps?.services?.Status;
            const address = status === kakaoStatus?.OK ? result?.[0] : null;
            onPickPlace(target, {
              ...picked,
              name:
                address?.road_address?.address_name ||
                address?.address?.address_name ||
                picked.name,
              address: address?.address?.address_name || '',
              road_address: address?.road_address?.address_name || '',
            });
            onActivePinTargetChange(target === 'start' ? 'end' : 'start');
          });
        });
        setMapState('ready');
      } catch {
        if (!ignore) setMapState('error');
      }
    }

    initializeMap();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (mapState !== 'ready' || !mapRef.current || !window.kakao?.maps) return;
    const kakao = window.kakao;
    const map = mapRef.current;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    const selectedPoints = [startPlace, endPlace]
      .filter((place) => place?.lat && place?.lng)
      .map((place) => new kakao.maps.LatLng(Number(place.lat), Number(place.lng)));
    const resultPlaces = (searchResults ?? []).filter((place) => place?.lat && place?.lng).slice(0, 8);
    const resultPoints = resultPlaces.map((place) => new kakao.maps.LatLng(Number(place.lat), Number(place.lng)));
    const allVisiblePoints = [...selectedPoints, ...resultPoints];

    if (startPlace?.lat && startPlace?.lng) {
      overlaysRef.current.push(
        new kakao.maps.Marker({
          map,
          position: new kakao.maps.LatLng(Number(startPlace.lat), Number(startPlace.lng)),
          title: startPlace.name,
        }),
      );
    }

    if (endPlace?.lat && endPlace?.lng) {
      overlaysRef.current.push(
        new kakao.maps.Marker({
          map,
          position: new kakao.maps.LatLng(Number(endPlace.lat), Number(endPlace.lng)),
          title: endPlace.name,
        }),
      );
    }

    resultPlaces.forEach((place) => {
      const marker = new kakao.maps.Marker({
        map,
        position: new kakao.maps.LatLng(Number(place.lat), Number(place.lng)),
        title: place.name,
      });
      kakao.maps.event.addListener(marker, 'click', () => {
        onPickPlace(searchResultTarget || activePinTargetRef.current, place, { keepSearchResults: true });
      });
      overlaysRef.current.push(marker);
    });

    if (selectedPoints.length >= 2) {
      const line = new kakao.maps.Polyline({
        path: selectedPoints,
        strokeWeight: 5,
        strokeColor: routeMode === 'car' ? '#4b5563' : '#0e2a22',
        strokeOpacity: 0.82,
        strokeStyle: routeMode === 'car' ? 'solid' : 'shortdash',
      });
      line.setMap(map);
      overlaysRef.current.push(line);
    }

    if (allVisiblePoints.length > 1) {
      const bounds = new kakao.maps.LatLngBounds();
      allVisiblePoints.forEach((point) => bounds.extend(point));
      map.setBounds(bounds, 42, 42, 42, 42);
    } else if (allVisiblePoints.length === 1) {
      map.setCenter(allVisiblePoints[0]);
      map.setLevel(4);
    }
  }, [startPlace, endPlace, searchResults, searchResultTarget, routeMode, mapState, onPickPlace]);

  return (
    <div className="mp-map-card">
      <div className="mp-map-header">
        <div>
          <span>지도에서 핀 찍기</span>
          <strong>{activePinTarget === 'start' ? '출발지를 선택 중' : '도착지를 선택 중'}</strong>
          {searchResults.length > 0 && (
            <em>{searchResultTarget === 'start' ? '출발지' : '도착지'} 검색 결과를 지도에서 선택하세요</em>
          )}
        </div>
        <div className="mp-map-targets">
          <button
            className={activePinTarget === 'start' ? 'active' : ''}
            type="button"
            onClick={() => onActivePinTargetChange('start')}
          >
            출발
          </button>
          <button
            className={activePinTarget === 'end' ? 'active' : ''}
            type="button"
            onClick={() => onActivePinTargetChange('end')}
          >
            도착
          </button>
        </div>
      </div>
      <div className="map-search-row">
        <input
          placeholder={activePinTarget === 'start' ? '출발지를 검색하세요' : '도착지를 검색하세요'}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(activePinTarget, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch(activePinTarget);
          }}
        />
        <button type="button" onClick={() => onSearch(activePinTarget)} aria-label="지도 장소 검색">
          <Search size={17} />
        </button>
      </div>
      {searchResults.length > 0 && (
        <div className="map-result-list">
          {searchResults.slice(0, 5).map((place) => (
            <button
              type="button"
              key={place.id}
              className={
                (activePinTarget === 'start' ? startPlace?.id : endPlace?.id) === place.id
                  ? 'active'
                  : ''
              }
              onClick={() => onPickPlace(searchResultTarget || activePinTarget, place, { keepSearchResults: true })}
            >
              <strong>{place.name}</strong>
              <span>{place.road_address || place.address || place.category}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mp-map-canvas-wrap">
        <div className="mp-kakao-map" ref={mapNodeRef} />
        {mapState === 'missing-key' && (
          <div className="mp-map-fallback">
            <strong>지도 API 키 필요</strong>
            <span>VITE_KAKAO_MAP_APP_KEY를 확인하세요</span>
          </div>
        )}
        {mapState === 'error' && (
          <div className="mp-map-fallback">
            <strong>지도를 불러오지 못했습니다</strong>
            <span>JavaScript 키와 localhost:5173 도메인을 확인하세요</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Admin Dashboard ─── */
function AdminDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [adminState, setAdminState] = useState('불러오는 중');
  const [selectedDeviceId, setSelectedDeviceId] = useState('all');
  const [adminPassword, setAdminPassword] = useState(() => sessionStorage.getItem(ADMIN_PASSWORD_SESSION_KEY) || '');
  const [passwordInput, setPasswordInput] = useState('');
  const [isAdminAuthed, setIsAdminAuthed] = useState(() => Boolean(sessionStorage.getItem(ADMIN_PASSWORD_SESSION_KEY)));

  const loadDashboard = async (password = adminPassword) => {
    if (!password) {
      setAdminState('비밀번호 필요');
      return;
    }
    setAdminState('불러오는 중');
    try {
      const result = await apiRequest('/api/admin/dashboard', {
        headers: { 'X-Admin-Password': password },
      });
      setDashboard(result);
      setAdminState('최신 데이터');
    } catch {
      sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY);
      setIsAdminAuthed(false);
      setAdminPassword('');
      setAdminState('불러오기 실패');
    }
  };

  const loginAdmin = async (event) => {
    event.preventDefault();
    const password = passwordInput.trim();
    if (!password) {
      setAdminState('비밀번호 필요');
      return;
    }
    setAdminState('확인 중');
    try {
      await apiRequest('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      sessionStorage.setItem(ADMIN_PASSWORD_SESSION_KEY, password);
      setAdminPassword(password);
      setIsAdminAuthed(true);
      setPasswordInput('');
      await loadDashboard(password);
    } catch {
      setAdminState('비밀번호가 맞지 않습니다');
    }
  };

  const logoutAdmin = () => {
    sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY);
    setAdminPassword('');
    setIsAdminAuthed(false);
    setDashboard(null);
    setAdminState('로그아웃됨');
  };

  useEffect(() => {
    if (isAdminAuthed) loadDashboard(adminPassword);
  }, []);

  if (!isAdminAuthed) {
    return (
      <main className="admin-shell admin-login-shell">
        <form className="admin-login-card" onSubmit={loginAdmin}>
          <span className="admin-kicker">Timebomb Admin</span>
          <h1>관리자 로그인</h1>
          <p>디바이스와 스케줄 대시보드를 보려면 관리자 비밀번호가 필요합니다.</p>
          <label>
            <span>비밀번호</span>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              autoFocus
              autoComplete="current-password"
              placeholder="ADMIN_PASSWORD"
            />
          </label>
          <button type="submit">들어가기</button>
          <small>{adminState}</small>
        </form>
      </main>
    );
  }

  const devices = dashboard?.devices ?? [];
  const visibleDevices =
    selectedDeviceId === 'all'
      ? devices
      : devices.filter((d) => d.device_id === selectedDeviceId);
  const schedules = visibleDevices.flatMap((d) =>
    d.schedules.map((s) => ({ ...s, device_id: d.device_id })),
  );

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <span className="admin-kicker">Timebomb Admin</span>
          <h1>디바이스 스케줄 대시보드</h1>
          <p>어떤 디바이스가 어떤 스케줄을 만들고 수정했는지 한눈에 확인합니다.</p>
        </div>
        <div className="admin-header-actions">
          <button className="admin-refresh" type="button" onClick={() => loadDashboard()}>
            <RotateCcw size={18} />새로고침
          </button>
          <button className="admin-refresh" type="button" onClick={logoutAdmin}>로그아웃</button>
        </div>
      </header>
      <section className="admin-metrics" aria-label="요약">
        <div><Smartphone size={20} /><span>디바이스</span><strong>{dashboard?.total_devices ?? 0}</strong></div>
        <div><CalendarDays size={20} /><span>스케줄</span><strong>{dashboard?.total_schedules ?? 0}</strong></div>
        <div><ListChecks size={20} /><span>블록</span><strong>{dashboard?.total_blocks ?? 0}</strong></div>
        <div><Clock3 size={20} /><span>총 시간</span><strong>{formatDuration(dashboard?.total_minutes ?? 0)}</strong></div>
      </section>
      <section className="admin-toolbar">
        <div>
          <Database size={18} />
          <span>{adminState}</span>
          <small>갱신 {formatDateTime(dashboard?.updated_at)}</small>
        </div>
        <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
          <option value="all">전체 디바이스</option>
          {devices.map((d) => (
            <option value={d.device_id} key={d.device_id}>{d.device_id}</option>
          ))}
        </select>
      </section>
      <section className="admin-grid">
        <div className="admin-device-list">
          {visibleDevices.map((d) => (
            <article className="admin-device-card" key={d.device_id}>
              <div className="admin-card-title"><Smartphone size={18} /><strong>{d.device_id}</strong></div>
              <div className="admin-device-stats">
                <span>{d.schedule_count}개 스케줄</span>
                <span>{d.block_count}개 블록</span>
                <span>{formatDuration(d.total_minutes)}</span>
              </div>
              <div className="admin-card-meta">생성 {formatDateTime(d.created_at)} · 수정 {formatDateTime(d.updated_at)}</div>
            </article>
          ))}
        </div>
        <div className="admin-schedule-list">
          {schedules.length === 0 ? (
            <div className="admin-empty">표시할 스케줄이 없습니다.</div>
          ) : (
            schedules.map((s) => (
              <article className="admin-schedule-card" key={`${s.device_id}-${s.id}`}>
                <div className="admin-schedule-head">
                  <div><span>{s.device_id}</span><strong>{s.name}</strong></div>
                  <b>{formatDuration(s.total_minutes)}</b>
                </div>
                <div className="admin-schedule-details">
                  <span>목표 {s.target_time}</span>
                  <span>여유 {s.buffer_minutes}분</span>
                  <span>{s.block_count}개 블록</span>
                  <span>수정 {formatDateTime(s.updated_at)}</span>
                </div>
                <div className="admin-category-bars">
                  {Object.entries(s.category_minutes).map(([catId, mins]) => (
                    <div key={catId}><span>{categoryName(catId)}</span><strong>{mins}분</strong></div>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

/* ─── Main App ─── */
function App() {
  const [deviceId] = useState(getDeviceId);
  const [profiles, setProfiles] = useState([defaultProfile]);
  const [activeProfileId, setActiveProfileId] = useState(
    () => localStorage.getItem(ACTIVE_PROFILE_KEY) || defaultProfile.id,
  );
  const [saveState, setSaveState] = useState('불러오는 중');
  const [draggedId, setDraggedId] = useState(null);
  const [routeForm, setRouteForm] = useState({ startQuery: '', endQuery: '' });
  const [startPlace, setStartPlace] = useState(null);
  const [endPlace, setEndPlace] = useState(null);
  const [startResults, setStartResults] = useState([]);
  const [endResults, setEndResults] = useState([]);
  const [searchResultTarget, setSearchResultTarget] = useState(null);
  const [routeState, setRouteState] = useState('장소 입력');
  const [routeMode, setRouteMode] = useState('transit');
  const [includeAlternatives, setIncludeAlternatives] = useState(true);
  const [routeOptions, setRouteOptions] = useState([]);
  const [isMobilePaletteOpen, setIsMobilePaletteOpen] = useState(false);
  const [mobileCategoryId, setMobileCategoryId] = useState(null);
  const [activePinTarget, setActivePinTarget] = useState('start');
  const [mobilePage, setMobilePage] = useState('setup'); // 'setup' | 'builder' | 'result'
  const [shareImage, setShareImage] = useState(null);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const plan = activeProfile?.plan ?? [];
  const targetTime = activeProfile?.targetTime ?? '09:00';
  const bufferMinutes = activeProfile?.bufferMinutes ?? 10;

  useEffect(() => {
    let ignore = false;
    async function load() {
      setSaveState('불러오는 중');
      try {
        const schedules = await apiRequest(`/api/devices/${encodeURIComponent(deviceId)}/schedules`);
        if (ignore) return;
        const next = schedules.map(normalizeProfile);
        setProfiles(next.length > 0 ? next : [defaultProfile]);
        const savedId = localStorage.getItem(ACTIVE_PROFILE_KEY);
        setActiveProfileId(next.find((p) => p.id === savedId)?.id ?? next[0]?.id ?? defaultProfile.id);
        setSaveState('저장됨');
      } catch {
        if (!ignore) setSaveState('서버 연결 필요');
      }
    }
    load();
    return () => { ignore = true; };
  }, [deviceId]);

  useEffect(() => {
    if (activeProfile?.id) localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfile.id);
  }, [activeProfile?.id]);

  useEffect(() => () => {
    if (shareImage?.url) URL.revokeObjectURL(shareImage.url);
  }, [shareImage?.url]);

  const persistProfile = async (profile = activeProfile) => {
    if (!profile) return;
    const name = profile.name.trim();
    if (!name) { setSaveState('제목 필요'); return; }
    setSaveState('저장 중');
    try {
      const payload = serializeProfile({ ...profile, name });
      const saved = profile.isNew
        ? await apiRequest(`/api/devices/${encodeURIComponent(deviceId)}/schedules`, {
            method: 'POST', body: JSON.stringify({ id: profile.id, ...payload }),
          })
        : await apiRequest(
            `/api/devices/${encodeURIComponent(deviceId)}/schedules/${encodeURIComponent(profile.id)}`,
            { method: 'PUT', body: JSON.stringify(payload) },
          );
      const sp = normalizeProfile(saved);
      setProfiles((cur) => cur.map((p) => (p.id === sp.id ? sp : p)));
      setSaveState('저장됨');
    } catch {
      setSaveState('저장 실패');
    }
  };

  const updateActiveProfile = (updates) => {
    if (!activeProfile) return;
    setProfiles((cur) => cur.map((p) => (p.id === activeProfile.id ? { ...activeProfile, ...updates } : p)));
    setSaveState('저장 안 됨');
  };

  const totalMinutes = useMemo(
    () => plan.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0),
    [plan],
  );
  const routeBlockCount = useMemo(() => plan.filter((b) => b.fromRoute).length, [plan]);

  const alarm = useMemo(() => {
    const tMins = parseTimeToMinutes(targetTime);
    const req = totalMinutes + (Number(bufferMinutes) || 0);
    const aMins = tMins - req;
    return { time: formatClock(aMins), requiredMinutes: req, dayLabel: aMins < 0 ? '전날' : '당일' };
  }, [bufferMinutes, targetTime, totalMinutes]);

  const addBlock = (categoryId, label) => {
    updateActiveProfile({ plan: [...plan, makeBlock(categoryId, label)] });
    setIsMobilePaletteOpen(false);
    setMobileCategoryId(null);
  };

  const insertBlocks = (blocks) => {
    if (!blocks.length) return;
    const next = blocks.map((b) => ({ ...b, id: `${b.id}-${crypto.randomUUID()}` }));
    updateActiveProfile({ plan: [...plan, ...next] });
  };

  // 기존 경로 블록을 교체 (수동 추가 블록은 보존)
  const replaceRouteBlocks = (blocks) => {
    if (!blocks.length) return;
    const manual = plan.filter((b) => !b.fromRoute);
    const next = blocks.map((b) => ({ ...b, id: `${b.id}-${crypto.randomUUID()}`, fromRoute: true }));
    updateActiveProfile({ plan: [...manual, ...next] });
  };

  const mergeRouteBlocks = () => {
    const routeBlocks = plan.filter((b) => b.fromRoute);
    if (routeBlocks.length <= 1) return;
    const mergedMinutes = routeBlocks.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0);
    const mergedBlock = {
      id: `route-merged-${crypto.randomUUID()}`,
      categoryId: routeBlocks.some((b) => b.categoryId === 'car') ? 'car' : 'inside',
      label: '이동하기',
      minutes: mergedMinutes,
      fromRoute: true,
      isMergedRoute: true,
      mergedBlockCount: routeBlocks.length,
      mergedRouteBlocks: routeBlocks.map((b) => ({
        ...b,
        isMergedRoute: false,
        mergedBlockCount: undefined,
        mergedRouteBlocks: undefined,
      })),
    };
    let mergedInserted = false;
    const nextPlan = plan.flatMap((b) => {
      if (!b.fromRoute) return [b];
      if (mergedInserted) return [];
      mergedInserted = true;
      return [mergedBlock];
    });
    updateActiveProfile({ plan: nextPlan });
  };

  const unmergeRouteBlock = (id) => {
    const target = plan.find((b) => b.id === id);
    if (!target?.isMergedRoute || !Array.isArray(target.mergedRouteBlocks)) return;
    const restoredBlocks = target.mergedRouteBlocks.map((b) => ({
      ...b,
      id: `${b.id ?? 'route-block'}-${crypto.randomUUID()}`,
      fromRoute: true,
      isMergedRoute: false,
      mergedBlockCount: undefined,
      mergedRouteBlocks: undefined,
    }));
    updateActiveProfile({
      plan: plan.flatMap((b) => (b.id === id ? restoredBlocks : [b])),
    });
  };

  const updateMinutes = (id, minutes) =>
    updateActiveProfile({
      plan: plan.map((b) =>
        b.id === id ? { ...b, minutes: normalizeMinutes(minutes) } : b,
      ),
    });

  const removeBlock = (id) => updateActiveProfile({ plan: plan.filter((b) => b.id !== id) });

  const moveBlock = (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const di = plan.findIndex((b) => b.id === draggedId);
    const ti = plan.findIndex((b) => b.id === targetId);
    if (di < 0 || ti < 0) return;
    const next = [...plan];
    const [dragged] = next.splice(di, 1);
    next.splice(ti, 0, dragged);
    updateActiveProfile({ plan: next });
  };

  const addProfile = () => {
    const next = makeProfile();
    setProfiles((cur) => [...cur, next]);
    setActiveProfileId(next.id);
    setSaveState('저장 안 됨');
  };

  const removeProfile = async () => {
    if (!activeProfile) return;
    if (activeProfile.isNew) {
      const next = profiles.filter((p) => p.id !== activeProfile.id);
      const fb = makeProfile();
      setProfiles(next.length > 0 ? next : [fb]);
      setActiveProfileId(next[0]?.id ?? fb.id);
      setSaveState('저장 안 됨');
      return;
    }
    setSaveState('삭제 중');
    try {
      await apiRequest(
        `/api/devices/${encodeURIComponent(deviceId)}/schedules/${encodeURIComponent(activeProfile.id)}`,
        { method: 'DELETE' },
      );
      const next = profiles.filter((p) => p.id !== activeProfile.id);
      const fb = makeProfile();
      setProfiles(next.length > 0 ? next : [fb]);
      setActiveProfileId(next[0]?.id ?? fb.id);
      setSaveState(next.length > 0 ? '저장됨' : '저장 안 됨');
    } catch {
      setSaveState('삭제 실패');
    }
  };

  const updateRouteField = (field, value) => setRouteForm((cur) => ({ ...cur, [field]: value }));

  const updateMapSearchQuery = (kind, value) => {
    updateRouteField(`${kind}Query`, value);
    setSearchResultTarget(kind);
    setActivePinTarget(kind);
    if (kind === 'start') {
      setStartPlace(null);
      setStartResults([]);
    } else {
      setEndPlace(null);
      setEndResults([]);
    }
    setRouteOptions([]);
  };

  const currentSearchPoint = startPlace
    ? `&lng=${encodeURIComponent(startPlace.lng)}&lat=${encodeURIComponent(startPlace.lat)}`
    : '';

  const searchPlaces = async (kind) => {
    const query = (kind === 'start' ? routeForm.startQuery : routeForm.endQuery).trim();
    if (!query) { setRouteState('검색어 필요'); return; }
    setRouteState('장소 검색 중');
    setActivePinTarget(kind);
    setSearchResultTarget(kind);
    try {
      const result = await apiRequest(
        `/api/places/search?query=${encodeURIComponent(query)}${kind === 'end' ? currentSearchPoint : ''}`,
      );
      if (kind === 'start') setStartResults(result.places ?? []);
      else setEndResults(result.places ?? []);
      setRouteState((result.places ?? []).length ? '지도에서 장소 선택' : '검색 결과 없음');
    } catch {
      setRouteState('장소 검색 실패');
    }
  };

  const selectPlace = (kind, place, options = {}) => {
    const keepSearchResults = Boolean(options.keepSearchResults);
    if (kind === 'start') {
      setStartPlace(place);
      if (!keepSearchResults) setStartResults([]);
      setRouteForm((cur) => ({ ...cur, startQuery: place.name }));
      if (!keepSearchResults) setActivePinTarget('end');
    } else {
      setEndPlace(place);
      if (!keepSearchResults) setEndResults([]);
      setRouteForm((cur) => ({ ...cur, endQuery: place.name }));
    }
    if (!keepSearchResults) setSearchResultTarget(null);
    setRouteOptions([]);
    setRouteState(`${kind === 'start' ? '출발지' : '도착지'} 선택됨`);
  };

  const clearPlace = (kind) => {
    if (kind === 'start') {
      setStartPlace(null);
      setStartResults([]);
      setRouteForm((cur) => ({ ...cur, startQuery: '' }));
      setActivePinTarget('start');
    } else {
      setEndPlace(null);
      setEndResults([]);
      setRouteForm((cur) => ({ ...cur, endQuery: '' }));
      setActivePinTarget('end');
    }
    setSearchResultTarget(null);
    setRouteOptions([]);
    setRouteState('장소 입력');
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setRouteState('현재 위치 불가'); return; }
    setRouteState('현재 위치 확인 중');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const place = {
          id: 'current-location', name: '현재 위치',
          address: '브라우저 위치', road_address: '', category: 'GPS',
          lng: pos.coords.longitude, lat: pos.coords.latitude,
        };
        setStartPlace(place); setStartResults([]);
        setSearchResultTarget(null);
        setRouteForm((cur) => ({ ...cur, startQuery: '현재 위치' }));
        setRouteState('도착지 선택');
      },
      () => setRouteState('위치 권한 필요'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const fetchRoute = async () => {
    if (!startPlace || !endPlace) { setRouteState('출발/도착 선택 필요'); return; }
    const payload = {
      start_lng: Number(startPlace.lng), start_lat: Number(startPlace.lat),
      end_lng: Number(endPlace.lng), end_lat: Number(endPlace.lat),
      search_path_type: 0, route_mode: routeMode, include_alternatives: includeAlternatives,
    };
    if ([payload.start_lng, payload.start_lat, payload.end_lng, payload.end_lat].some(Number.isNaN)) {
      setRouteState('좌표 확인 필요'); return;
    }
    setRouteState('조회 중');
    try {
      const result = await apiRequest('/api/transit/estimate', { method: 'POST', body: JSON.stringify(payload) });
      const routes = result.routes ?? [];
      const shortest = routes[0];
      if (!shortest) { setRouteOptions([]); setRouteState('경로 없음'); return; }
      replaceRouteBlocks(shortest.blocks ?? []);
      setRouteOptions(routes.slice(1));
      const modeLabel = routeModes.find((m) => m.id === routeMode)?.label ?? '경로';
      setRouteState(`${modeLabel} ${shortest.total_minutes}분 경로 추가됨`);
    } catch {
      setRouteOptions([]); setRouteState('조회 실패');
    }
  };

  const createStoryImageBlob = async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const visibleCategories = categories
      .map((cat) => ({
        ...cat,
        minutes: plan
          .filter((block) => block.categoryId === cat.id)
          .reduce((sum, block) => sum + normalizeMinutes(block.minutes), 0),
      }))
      .filter((cat) => cat.minutes > 0);
    const rowHeight = 112;
    const breakdownHeight = Math.max(0, visibleCategories.length) * 86;
    const contentHeight = 1120 + Math.max(plan.length, 1) * rowHeight + breakdownHeight;
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = Math.max(1920, contentHeight);
    const ctx = canvas.getContext('2d');
    const drawText = (text, x, y, maxWidth, lineHeight, maxLines = 2) => {
      const words = String(text).split(' ');
      const lines = [];
      let line = '';
      words.forEach((word) => {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      });
      if (line) lines.push(line);
      lines.slice(0, maxLines).forEach((value, index) => {
        const suffix = lines.length > maxLines && index === maxLines - 1 ? '...' : '';
        ctx.fillText(`${value}${suffix}`, x, y + index * lineHeight);
      });
    };

    ctx.fillStyle = '#0e2a22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5c53a';
    ctx.fillRect(70, 86, 940, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '800 34px Pretendard, sans-serif';
    ctx.fillText('TIMEBOMB ROUTINE', 70, 168);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 58px Pretendard, sans-serif';
    ctx.fillText(activeProfile?.name || '나의 루틴', 70, 246);
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.font = '800 34px Pretendard, sans-serif';
    ctx.fillText(`${alarm.dayLabel} 알람`, 70, 370);
    ctx.fillStyle = '#f5c53a';
    ctx.font = '900 190px Pretendard, sans-serif';
    ctx.fillText(alarm.time, 70, 548);

    const statCards = [
      ['총 소요시간', formatDuration(totalMinutes)],
      ['도착 목표', targetTime],
      ['여유시간', `${bufferMinutes}분`],
    ];
    statCards.forEach(([label, value], index) => {
      const x = 70 + index * 318;
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.roundRect(x, 640, 292, 132, 30);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '800 26px Pretendard, sans-serif';
      ctx.fillText(label, x + 30, 690);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 42px Pretendard, sans-serif';
      ctx.fillText(value, x + 30, 742);
    });

    let y = 890;
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.font = '900 30px Pretendard, sans-serif';
    ctx.fillText('해야 할 순서', 70, y);
    y += 86;

    if (plan.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.roundRect(70, y - 58, 940, 102, 30);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      ctx.font = '800 30px Pretendard, sans-serif';
      ctx.fillText('아직 정해진 순서가 없습니다.', 110, y);
      y += rowHeight;
    }

    plan.forEach((block, index) => {
      const cat = getCategory(block.categoryId);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.roundRect(70, y - 58, 940, 102, 30);
      ctx.fill();
      ctx.fillStyle = cat.color;
      ctx.beginPath();
      ctx.arc(122, y - 8, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 28px Pretendard, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(index + 1), 122, y + 2);
      ctx.textAlign = 'left';
      ctx.font = '900 38px Pretendard, sans-serif';
      drawText(block.label, 170, y - 18, 640, 42, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      ctx.font = '800 24px Pretendard, sans-serif';
      ctx.fillText(block.isMergedRoute ? '이동 블록 합침' : cat.name, 170, y + 26);
      ctx.fillStyle = '#f5c53a';
      ctx.font = '900 34px Pretendard, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${normalizeMinutes(block.minutes)}분`, 960, y + 2);
      ctx.textAlign = 'left';
      y += rowHeight;
    });

    y += 48;
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.font = '900 30px Pretendard, sans-serif';
    ctx.fillText('카테고리별 시간', 70, y);
    y += 58;

    visibleCategories.forEach((cat) => {
      const pct = totalMinutes > 0 ? cat.minutes / totalMinutes : 0;
      ctx.fillStyle = cat.color;
      ctx.beginPath();
      ctx.roundRect(70, y - 26, 52, 52, 15);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 30px Pretendard, sans-serif';
      ctx.fillText(cat.name, 146, y - 4);
      ctx.textAlign = 'right';
      ctx.fillText(`${cat.minutes}분`, 1008, y - 4);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.roundRect(146, y + 20, 862, 14, 999);
      ctx.fill();
      ctx.fillStyle = cat.color;
      ctx.beginPath();
      ctx.roundRect(146, y + 20, Math.max(18, 862 * pct), 14, 999);
      ctx.fill();
      y += 86;
    });

    ctx.fillStyle = '#f5c53a';
    ctx.font = '900 38px Pretendard, sans-serif';
    ctx.fillText('timebomb', 70, canvas.height - 120);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '800 28px Pretendard, sans-serif';
    ctx.fillText(window.location.origin, 70, canvas.height - 76);
    return canvasToBlob(canvas);
  };

  const shareStoryImage = async () => {
    try {
      const blob = await createStoryImageBlob();
      const file = new File([blob], `timebomb-${activeProfile?.name || 'routine'}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'Timebomb 알람 결과' });
        return;
      }
      setShareImage((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { url: URL.createObjectURL(blob), name: file.name };
      });
      setSaveState('이미지 준비됨');
    } catch {
      setSaveState('스토리 이미지 실패');
    }
  };

  const downloadShareImage = () => {
    if (!shareImage?.url) return;
    const link = document.createElement('a');
    link.href = shareImage.url;
    link.download = shareImage.name;
    link.click();
  };

  const closeShareImage = () => {
    setShareImage((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const shareSite = async () => {
    const data = {
      title: 'Timebomb',
      text: '내 출발 알람 루틴 같이 만들어봐',
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(data.url);
      setSaveState('링크 복사됨');
    } catch {
      setSaveState('공유 실패');
    }
  };

  const mobileCategory = categories.find((c) => c.id === mobileCategoryId);

  /* ── Shared: Route panel ── */
  const RoutePanelUI = () => (
    <div className="route-panel">
      <div className="alarm-title"><Train size={18} /><span>경로 가져오기</span></div>
      <button className="wide-button secondary" type="button" onClick={useCurrentLocation}>
        <LocateFixed size={16} />현재 위치로 출발
      </button>
      <div className="route-mode-tabs">
        {routeModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              className={`route-mode-button${routeMode === mode.id ? ' active' : ''}`}
              type="button"
              onClick={() => { setRouteMode(mode.id); setRouteOptions([]); setRouteState('경로 조회 가능'); }}
            >
              <Icon size={16} /><span>{mode.label}</span>
            </button>
          );
        })}
      </div>
      <label className="route-toggle">
        <input type="checkbox" checked={includeAlternatives} onChange={(e) => setIncludeAlternatives(e.target.checked)} />
        <span>대안 경로 함께 보기</span>
      </label>
      {[
        { kind: 'start', place: startPlace },
        { kind: 'end', place: endPlace },
      ].map(({ kind, place }) => (
        <div className="place-search place-search-readonly" key={kind}>
          <span className="route-place-label">{kind === 'start' ? '출발지' : '도착지'}</span>
          {place && (
            <div className="selected-place">
              <span>{kind === 'start' ? '출발' : '도착'}: {place.name}</span>
              <button type="button" onClick={() => clearPlace(kind)} aria-label={`${kind === 'start' ? '출발지' : '도착지'} 선택 삭제`}>
                <X size={13} />
              </button>
            </div>
          )}
          {!place && (
            <button className="route-empty-place" type="button" onClick={() => setActivePinTarget(kind)}>
              지도 상단에서 {kind === 'start' ? '출발지' : '도착지'}를 선택하세요
            </button>
          )}
        </div>
      ))}
      <button className="wide-button" type="button" onClick={fetchRoute}>검색해서 보드에 추가</button>
      <p className="route-state">{routeState}</p>
      {routeOptions.length > 0 && (
        <div className="route-options">
          {routeOptions.map((route, i) => (
            <button className="route-option" type="button" key={`${route.title}-${i}`} onClick={() => replaceRouteBlocks(route.blocks ?? [])}>
              <strong>{route.total_minutes}분</strong>
              <span>{route.title || `대안 경로 ${i + 2}`} · {route.blocks?.length ?? 0}개 블록으로 교체</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /* ── Shared: Palette sheet ── */
  const PaletteSheet = () => (
    <div className="mobile-palette-shell" role="dialog" aria-modal="true">
      <button
        className="mobile-palette-backdrop"
        type="button"
        aria-label="닫기"
        onClick={() => { setIsMobilePaletteOpen(false); setMobileCategoryId(null); }}
      />
      <section className="mobile-palette-sheet" aria-label="블록 메뉴">
        <div className="mobile-sheet-header">
          {mobileCategory ? (
            <button className="sheet-icon-button" type="button" onClick={() => setMobileCategoryId(null)}>
              <ChevronLeft size={22} />
            </button>
          ) : <div className="sheet-spacer" />}
          <strong>{mobileCategory?.name ?? '블록 선택'}</strong>
          <button className="sheet-icon-button" type="button"
            onClick={() => { setIsMobilePaletteOpen(false); setMobileCategoryId(null); }}>
            <X size={22} />
          </button>
        </div>
        {mobileCategory ? (
          <div className="mobile-block-list">
            {mobileCategory.blocks.map((label) => (
              <button
                className="palette-block"
                key={label}
                style={{ '--block-color': mobileCategory.color, '--block-soft': mobileCategory.soft }}
                type="button"
                onClick={() => addBlock(mobileCategory.id, label)}
              >
                <Plus size={14} /><span>{label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mobile-category-list">
            {categories.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  className="mobile-category-button"
                  key={cat.id}
                  type="button"
                  style={{ '--block-color': cat.color, '--block-soft': cat.soft }}
                  onClick={() => setMobileCategoryId(cat.id)}
                >
                  <Icon size={20} /><span>{cat.name}</span><strong>{cat.blocks.length}</strong>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <main className="app">

      {/* ══════════════════════════════════════
          DESKTOP: 3-panel layout
      ══════════════════════════════════════ */}
      <section className="workspace">
        <aside className="palette" aria-label="시간 블록 팔레트">
          <div className="brand">
            <div className="brand-mark"><Clock3 size={24} /></div>
            <div>
              <h1>Timebomb</h1>
              <p>아침 루틴 시간 계산기</p>
            </div>
          </div>
          <div className="category-list">
            {categories.map((cat) => {
              const Icon = cat.icon;
              return (
                <section className="category" key={cat.id}>
                  <div className="category-title" style={{ color: cat.color }}>
                    <Icon size={17} /><span>{cat.name}</span>
                  </div>
                  <div className="block-buttons">
                    {cat.blocks.map((label) => (
                      <button
                        className="palette-block"
                        key={label}
                        style={{ '--block-color': cat.color, '--block-soft': cat.soft }}
                        onClick={() => addBlock(cat.id, label)}
                      >
                        <Plus size={14} /><span>{label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </aside>

        <section className="builder" aria-label="시간 계산 빌더">
          <div className="builder-header">
            <div>
              <p className="eyebrow">블록을 눌러 추가하고 시간을 입력하세요 · {saveState}</p>
              <h2>{activeProfile?.name ?? '출근'}</h2>
            </div>
            <div className="schedule-controls">
              <input
                aria-label="일정 제목"
                placeholder="일정 제목"
                value={activeProfile?.name ?? ''}
                onChange={(e) => updateActiveProfile({ name: e.target.value })}
              />
              <button className="text-button" onClick={() => persistProfile()}><Save size={17} /><span>저장하기</span></button>
              <button className="text-button" onClick={removeProfile}><Trash2 size={17} /><span>삭제하기</span></button>
              <button className="icon-button" aria-label="새 일정" onClick={addProfile}><Plus size={19} /></button>
              <button className="icon-button" aria-label="초기화" onClick={() => updateActiveProfile({ plan: [] })}><RotateCcw size={19} /></button>
            </div>
          </div>
          <div className="schedule-list">
            {profiles.map((p) => (
              <button
                className={`schedule-chip ${p.id === activeProfile?.id ? 'is-active' : ''}`}
                key={p.id}
                type="button"
                onClick={() => setActiveProfileId(p.id)}
              >
                <strong>{p.name || '제목 없음'}</strong>
                <span>{p.plan?.length ?? 0}개 블록</span>
              </button>
            ))}
          </div>
          <div className="timeline">
            {plan.length === 0 ? (
              <div className="empty-state">왼쪽 블록을 눌러 루틴을 조립하세요.</div>
            ) : plan.map((block, index) => {
              const cat = getCategory(block.categoryId);
              return (
                <article
                  className="time-block"
                  draggable
                  key={block.id}
                  onDragStart={() => setDraggedId(block.id)}
                  onDragOver={(e) => { e.preventDefault(); moveBlock(block.id); }}
                  onDragEnd={() => setDraggedId(null)}
                  style={{ '--block-color': cat.color, '--block-soft': cat.soft }}
                >
                  <span className="connector connector-top" aria-hidden="true" />
                  <div className="block-grip" aria-hidden="true"><GripVertical size={18} /></div>
                  <div className="block-index">{index + 1}</div>
                  <div className="block-main">
                    <strong>{block.label}</strong>
                    <span>{cat.name}</span>
                  </div>
                  <label className="minute-field">
                    <input type="number" min="0" max="999" value={normalizeMinutes(block.minutes)} onChange={(e) => updateMinutes(block.id, e.target.value)} />
                    <span>분</span>
                  </label>
                  <button className="delete-button" aria-label={`${block.label} 삭제`} onClick={() => removeBlock(block.id)}>
                    <Trash2 size={18} />
                  </button>
                  <span className="connector connector-bottom" aria-hidden="true" />
                </article>
              );
            })}
          </div>
        </section>

        <aside className="summary" aria-label="총 시간">
          <div className="alarm-panel">
            <div className="alarm-title"><AlarmClock size={18} /><span>알람 계산</span></div>
            <label className="time-field">
              <span>도착 목표</span>
              <input type="time" value={targetTime} onChange={(e) => updateActiveProfile({ targetTime: e.target.value })} />
            </label>
            <label className="time-field">
              <span>여유 시간</span>
              <div className="buffer-input">
                <input type="number" min="0" max="240" value={bufferMinutes}
                  onChange={(e) => updateActiveProfile({ bufferMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} />
                <span>분</span>
              </div>
            </label>
            <div className="alarm-result">
              <span>{alarm.dayLabel} 알람</span>
              <strong>{alarm.time}</strong>
            </div>
          </div>
          <KakaoPlacePickerMap
            startPlace={startPlace}
            endPlace={endPlace}
            searchResults={searchResultTarget === 'start' ? startResults : searchResultTarget === 'end' ? endResults : []}
            searchResultTarget={searchResultTarget}
            searchQuery={activePinTarget === 'start' ? routeForm.startQuery : routeForm.endQuery}
            routeMode={routeMode}
            activePinTarget={activePinTarget}
            onActivePinTargetChange={setActivePinTarget}
            onSearchQueryChange={updateMapSearchQuery}
            onSearch={searchPlaces}
            onPickPlace={selectPlace}
          />
          {RoutePanelUI()}
          <div className="total-panel">
            <p>총 소요 시간</p>
            <strong>{formatDuration(totalMinutes)}</strong>
            <span>여유 포함 {alarm.requiredMinutes}분</span>
          </div>
          <div className="breakdown">
            {categories.map((cat) => {
              const sub = plan.filter((b) => b.categoryId === cat.id).reduce((s, b) => s + (Number(b.minutes) || 0), 0);
              return (
                <div className="breakdown-row" key={cat.id}>
                  <span className="dot" style={{ backgroundColor: cat.color }} />
                  <span>{cat.name}</span>
                  <strong>{sub}분</strong>
                </div>
              );
            })}
          </div>
        </aside>
      </section>


      {/* ══════════════════════════════════════
          MOBILE PAGE 1: 설정 (Setup)
      ══════════════════════════════════════ */}
      <div className={`mp mp-setup${mobilePage === 'setup' ? ' mp-active' : ''}`}>
        <div className="mp-header">
          <div className="mp-brand">
            <div className="mp-brand-icon"><Clock3 size={19} /></div>
            <span>Timebomb</span>
          </div>
          <button className="mp-text-btn" onClick={() => setMobilePage('result')}>
            결과 <ChevronRight size={15} />
          </button>
        </div>

        <div className="mp-tabs">
          <div className="mp-tabs-scroll">
            {profiles.map((p) => (
              <button
                key={p.id}
                className={`mp-tab${p.id === activeProfileId ? ' mp-tab-active' : ''}`}
                onClick={() => setActiveProfileId(p.id)}
              >
                {p.name || '제목 없음'}
              </button>
            ))}
            <button className="mp-tab mp-tab-add" onClick={addProfile}><Plus size={14} /></button>
          </div>
        </div>

        <div className="mp-card">
          <p className="mp-card-label"><AlarmClock size={14} />알람 설정</p>
          <input
            className="mp-name-input"
            placeholder="일정 이름을 입력하세요"
            value={activeProfile?.name ?? ''}
            onChange={(e) => updateActiveProfile({ name: e.target.value })}
          />
          <div className="mp-field-row">
            <label className="mp-field">
              <span>도착 목표시간</span>
              <input type="time" value={targetTime} onChange={(e) => updateActiveProfile({ targetTime: e.target.value })} />
            </label>
            <label className="mp-field">
              <span>여유시간</span>
              <div className="mp-with-unit">
                <input
                  type="number" min="0" max="240" value={bufferMinutes}
                  onChange={(e) => updateActiveProfile({ bufferMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
                />
                <span>분</span>
              </div>
            </label>
          </div>
          <div className="mp-alarm-preview">
            <div>
              <p className="mp-ap-label">{alarm.dayLabel}</p>
              <strong className="mp-ap-time">{alarm.time}</strong>
            </div>
            <div className="mp-ap-right">
              <AlarmClock size={18} />
              <span>{alarm.requiredMinutes}분 필요</span>
            </div>
          </div>
        </div>

        <div className="mp-route-wrap">
          <KakaoPlacePickerMap
            startPlace={startPlace}
            endPlace={endPlace}
            searchResults={searchResultTarget === 'start' ? startResults : searchResultTarget === 'end' ? endResults : []}
            searchResultTarget={searchResultTarget}
            searchQuery={activePinTarget === 'start' ? routeForm.startQuery : routeForm.endQuery}
            routeMode={routeMode}
            activePinTarget={activePinTarget}
            onActivePinTargetChange={setActivePinTarget}
            onSearchQueryChange={updateMapSearchQuery}
            onSearch={searchPlaces}
            onPickPlace={selectPlace}
          />
          {RoutePanelUI()}
        </div>

        <div className="mp-action-row">
          <button className="mp-btn-secondary" onClick={removeProfile}><Trash2 size={15} />삭제</button>
          <button className="mp-btn-secondary" onClick={() => persistProfile()}><Save size={15} />저장</button>
          <button className="mp-cta" onClick={() => setMobilePage('builder')}>
            루틴 편집하기<ChevronRight size={17} />
          </button>
        </div>
      </div>


      {/* ══════════════════════════════════════
          MOBILE PAGE 2: 루틴 (Builder)
      ══════════════════════════════════════ */}
      <div className={`mp mp-builder-page${mobilePage === 'builder' ? ' mp-active' : ''}`}>
        <div className="mp-page-header">
          <button className="mp-back" onClick={() => setMobilePage('setup')}><ChevronLeft size={22} /></button>
          <h1 className="mp-page-title">{activeProfile?.name ?? '루틴'}</h1>
          <button className="mp-next" onClick={() => setMobilePage('result')}>결과<ChevronRight size={16} /></button>
        </div>

        {/* ★ 실시간 알람 바 */}
        <div className="mp-alarm-bar">
          <div className="mp-ab-total">
            <span>총 소요</span>
            <strong>{formatDuration(totalMinutes)}</strong>
          </div>
          <div className="mp-ab-divider" />
          <div className="mp-ab-wake">
            <span>일어나야 할 시간</span>
            <strong>{alarm.time}</strong>
          </div>
        </div>

        {routeBlockCount > 1 && (
          <button className="mp-merge-route" type="button" onClick={mergeRouteBlocks}>
            <Train size={16} />
            <span>이동 블록 합치기</span>
            <strong>{routeBlockCount}개 → 1개</strong>
          </button>
        )}

        {/* Block timeline */}
        <div className="mp-timeline">
          {plan.length === 0 ? (
            <div className="mp-empty">아래 + 버튼을 눌러 루틴을 추가하세요</div>
          ) : plan.map((block, index) => {
            const cat = getCategory(block.categoryId);
            return (
              <article
                className={`mp-block${block.isMergedRoute ? ' mp-block-compact' : ''}`}
                draggable
                key={block.id}
                onDragStart={() => setDraggedId(block.id)}
                onDragOver={(e) => { e.preventDefault(); moveBlock(block.id); }}
                onDragEnd={() => setDraggedId(null)}
                style={{ '--bc': cat.color }}
              >
                <div className="mp-block-studs" />
                <div className="mp-block-body">
                  <div className="mp-block-left">
                    <span className="mp-block-num">{index + 1}</span>
	                    <div className="mp-block-info">
	                      <strong>{block.label}</strong>
	                      <span>
                          {block.isMergedRoute
                            ? `${block.mergedBlockCount ?? 0}개 이동 블록 합침`
                            : cat.name}
                        </span>
	                    </div>
                  </div>
                  <div className="mp-block-right">
                    <label className="mp-minute">
                      <input
                        type="number" min="0" max="999" value={normalizeMinutes(block.minutes)}
                        onChange={(e) => updateMinutes(block.id, e.target.value)}
                      />
                      <span>분</span>
                    </label>
                    {block.isMergedRoute && (
                      <button
                        className="mp-unmerge"
                        type="button"
                        onClick={() => unmergeRouteBlock(block.id)}
                        aria-label="이동 블록 풀기"
                      >
                        풀기
                      </button>
                    )}
                    <button className="mp-del" onClick={() => removeBlock(block.id)}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="mp-block-peg" />
              </article>
            );
          })}
        </div>
      </div>


      {/* ══════════════════════════════════════
          MOBILE PAGE 3: 결과 (Result)
      ══════════════════════════════════════ */}
      <div className={`mp mp-result-page${mobilePage === 'result' ? ' mp-active' : ''}`}>
        <div className="mp-page-header mp-page-header--dark">
          <button className="mp-back mp-back--light" onClick={() => setMobilePage('builder')}><ChevronLeft size={22} /></button>
          <h1 className="mp-page-title mp-page-title--light">결과</h1>
          <button className="mp-save-btn" onClick={() => persistProfile()}><Save size={20} /></button>
        </div>

        <div className="mp-result-hero">
          <p className="mp-rh-label">{alarm.dayLabel} 알람</p>
          <strong className="mp-rh-time">{alarm.time}</strong>
          <p className="mp-rh-sub">이 시간에 일어나야 해요</p>
        </div>

        <div className="mp-stats-row">
          <div className="mp-stat">
            <span>총 소요시간</span>
            <strong>{formatDuration(totalMinutes)}</strong>
          </div>
          <div className="mp-stat">
            <span>도착 목표</span>
            <strong>{targetTime}</strong>
          </div>
          <div className="mp-stat">
            <span>여유시간</span>
            <strong>{bufferMinutes}분</strong>
          </div>
        </div>

        <div className="mp-share-section">
          <button className="mp-share-primary" type="button" onClick={shareStoryImage}>
            <Download size={17} />
            <span>결과 이미지 저장</span>
          </button>
          <button className="mp-share-secondary" type="button" onClick={shareSite}>
            <Share2 size={17} />
            <span>친구에게 공유</span>
          </button>
        </div>

        <div className="mp-sequence-section">
          <p className="mp-seq-title">해야 할 순서</p>
          {plan.length === 0 ? (
            <div className="mp-seq-empty">아직 정해진 순서가 없습니다.</div>
          ) : (
            <div className="mp-seq-list">
              {plan.map((block, index) => {
                const cat = getCategory(block.categoryId);
                return (
                  <div className="mp-seq-row" key={block.id}>
                    <span className="mp-seq-num">{index + 1}</span>
                    <div className="mp-seq-main">
                      <strong>{block.label}</strong>
                      <span>{block.isMergedRoute ? '이동 블록 합침' : cat.name}</span>
                    </div>
                    <b>{Number(block.minutes) || 0}분</b>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mp-breakdown-section">
          <p className="mp-bd-title">카테고리별 시간</p>
          {categories.map((cat) => {
            const Icon = cat.icon;
            const sub = plan.filter((b) => b.categoryId === cat.id).reduce((s, b) => s + (Number(b.minutes) || 0), 0);
            if (sub === 0) return null;
            const pct = totalMinutes > 0 ? (sub / totalMinutes) * 100 : 0;
            return (
              <div className="mp-bd-row" key={cat.id}>
                <div className="mp-bd-icon" style={{ background: cat.color }}><Icon size={15} /></div>
                <div className="mp-bd-content">
                  <div className="mp-bd-label-row">
                    <span>{cat.name}</span>
                    <strong>{sub}분</strong>
                  </div>
                  <div className="mp-bd-track">
                    <div className="mp-bd-fill" style={{ width: `${pct}%`, background: cat.color }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button className="mp-edit-cta" onClick={() => setMobilePage('builder')}>
          <RotateCcw size={16} />다시 편집하기
        </button>
      </div>


      {/* ══════════════════════════════════════
          MOBILE FAB (builder only)
      ══════════════════════════════════════ */}
      {mobilePage === 'builder' && (
        <button className="mobile-palette-button" type="button" aria-label="블록 추가" onClick={() => setIsMobilePaletteOpen(true)}>
          <Plus size={22} /><span>블록</span>
        </button>
      )}

      {isMobilePaletteOpen && <PaletteSheet />}
      {shareImage && (
        <div className="share-image-modal" role="dialog" aria-modal="true">
          <button className="share-image-backdrop" type="button" aria-label="닫기" onClick={closeShareImage} />
          <section className="share-image-sheet">
            <div className="share-image-head">
              <strong>결과 이미지</strong>
              <button type="button" onClick={closeShareImage} aria-label="닫기"><X size={18} /></button>
            </div>
            <img src={shareImage.url} alt="Timebomb 결과 이미지" />
            <div className="share-image-actions">
              <button type="button" onClick={downloadShareImage}>
                <Download size={16} />
                다운로드
              </button>
              <a href={shareImage.url} target="_blank" rel="noreferrer">
                새 창 열기
              </a>
            </div>
            <p>카카오톡 안에서는 이미지를 길게 눌러 저장하거나 새 창에서 열어 저장하세요.</p>
          </section>
        </div>
      )}
    </main>
  );
}

const Root = window.location.pathname.startsWith('/admin') ? AdminDashboard : App;
createRoot(document.getElementById('root')).render(<Root />);

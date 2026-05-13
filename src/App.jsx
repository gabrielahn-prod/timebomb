import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlarmClock,
  Bath,
  Bus,
  ChevronLeft,
  Clock3,
  GripVertical,
  Home,
  LocateFixed,
  Menu,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Train,
  Trash2,
  X,
} from 'lucide-react';
import './styles.css';

const ACTIVE_PROFILE_KEY = 'timebomb:active-profile-id:v1';
const DEVICE_ID_KEY = 'timebomb:device-id:v1';
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

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
    name: '단지 이동',
    icon: Home,
    color: '#f4a261',
    soft: '#ffefd9',
    blocks: ['엘리베이터', '계단', '현관까지 이동'],
  },
  {
    id: 'bus',
    name: '버스',
    icon: Bus,
    color: '#3f7cac',
    soft: '#dcecff',
    blocks: ['버스 평균 대기시간', '버스 시간표 맞추기', '버스 탑승 시간'],
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
  return categories.find((category) => category.id === categoryId) ?? categories[0];
}

function formatDuration(minutes) {
  const safeMinutes = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  if (hours === 0) return `${rest}분`;
  return `${hours}시간 ${rest}분`;
}

function parseTimeToMinutes(time) {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function formatClock(minutes) {
  const day = 24 * 60;
  const normalized = ((minutes % day) + day) % day;
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
  const rest = String(normalized % 60).padStart(2, '0');
  return `${hours}:${rest}`;
}

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = `device-${crypto.randomUUID().slice(0, 8)}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function makeProfile(name = '새 일정') {
  const id = `profile-${crypto.randomUUID().slice(0, 8)}`;
  return {
    ...defaultProfile,
    id,
    name,
    plan: [],
    isNew: true,
  };
}

function normalizeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    plan: Array.isArray(profile.plan) ? profile.plan : [],
    targetTime: profile.target_time ?? profile.targetTime ?? '09:00',
    bufferMinutes: profile.buffer_minutes ?? profile.bufferMinutes ?? 10,
    isNew: false,
  };
}

function serializeProfile(profile) {
  return {
    name: profile.name || '새 일정',
    target_time: profile.targetTime || '09:00',
    buffer_minutes: Math.max(0, Math.min(240, Number(profile.bufferMinutes) || 0)),
    plan: Array.isArray(profile.plan) ? profile.plan : [],
  };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function App() {
  const [deviceId] = useState(getDeviceId);
  const [profiles, setProfiles] = useState([defaultProfile]);
  const [activeProfileId, setActiveProfileId] = useState(
    () => localStorage.getItem(ACTIVE_PROFILE_KEY) || defaultProfile.id,
  );
  const [saveState, setSaveState] = useState('불러오는 중');
  const [draggedId, setDraggedId] = useState(null);
  const [routeForm, setRouteForm] = useState({
    startQuery: '',
    endQuery: '',
  });
  const [startPlace, setStartPlace] = useState(null);
  const [endPlace, setEndPlace] = useState(null);
  const [startResults, setStartResults] = useState([]);
  const [endResults, setEndResults] = useState([]);
  const [routeState, setRouteState] = useState('장소 입력');
  const [routeOptions, setRouteOptions] = useState([]);
  const [isMobilePaletteOpen, setIsMobilePaletteOpen] = useState(false);
  const [mobileCategoryId, setMobileCategoryId] = useState(null);

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const plan = activeProfile?.plan ?? [];
  const targetTime = activeProfile?.targetTime ?? '09:00';
  const bufferMinutes = activeProfile?.bufferMinutes ?? 10;

  useEffect(() => {
    let ignore = false;

    async function loadSchedules() {
      setSaveState('불러오는 중');
      try {
        const schedules = await apiRequest(`/api/devices/${encodeURIComponent(deviceId)}/schedules`);
        if (ignore) return;
        const nextProfiles = schedules.map(normalizeProfile);
        setProfiles(nextProfiles.length > 0 ? nextProfiles : [defaultProfile]);
        const savedActiveId = localStorage.getItem(ACTIVE_PROFILE_KEY);
        const nextActive =
          nextProfiles.find((profile) => profile.id === savedActiveId)?.id ?? nextProfiles[0]?.id;
        setActiveProfileId(nextActive ?? defaultProfile.id);
        setSaveState('저장됨');
      } catch {
        if (!ignore) setSaveState('서버 연결 필요');
      }
    }

    loadSchedules();

    return () => {
      ignore = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (activeProfile?.id) {
      localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfile.id);
    }
  }, [activeProfile?.id]);

  const persistProfile = async (profile = activeProfile) => {
    if (!profile) return;
    const trimmedName = profile.name.trim();
    if (!trimmedName) {
      setSaveState('제목 필요');
      return;
    }
    setSaveState('저장 중');
    try {
      const payload = serializeProfile({ ...profile, name: trimmedName });
      const saved = profile.isNew
        ? await apiRequest(`/api/devices/${encodeURIComponent(deviceId)}/schedules`, {
            method: 'POST',
            body: JSON.stringify({ id: profile.id, ...payload }),
          })
        : await apiRequest(
            `/api/devices/${encodeURIComponent(deviceId)}/schedules/${encodeURIComponent(profile.id)}`,
            {
              method: 'PUT',
              body: JSON.stringify(payload),
            },
          );
      const savedProfile = normalizeProfile(saved);
      setProfiles((current) =>
        current.map((item) => (item.id === savedProfile.id ? savedProfile : item)),
      );
      setSaveState('저장됨');
    } catch {
      setSaveState('저장 실패');
    }
  };

  const updateActiveProfile = (updates) => {
    if (!activeProfile) return;
    const nextProfile = { ...activeProfile, ...updates };
    setProfiles((current) =>
      current.map((profile) =>
        profile.id === activeProfile.id ? nextProfile : profile,
      ),
    );
    setSaveState('저장 안 됨');
  };

  const totalMinutes = useMemo(
    () => plan.reduce((sum, block) => sum + (Number(block.minutes) || 0), 0),
    [plan],
  );

  const alarm = useMemo(() => {
    const targetMinutes = parseTimeToMinutes(targetTime);
    const requiredMinutes = totalMinutes + (Number(bufferMinutes) || 0);
    const alarmMinutes = targetMinutes - requiredMinutes;
    return {
      time: formatClock(alarmMinutes),
      requiredMinutes,
      dayLabel: alarmMinutes < 0 ? '전날' : '당일',
    };
  }, [bufferMinutes, targetTime, totalMinutes]);

  const addBlock = (categoryId, label) => {
    updateActiveProfile({ plan: [...plan, makeBlock(categoryId, label)] });
    setIsMobilePaletteOpen(false);
    setMobileCategoryId(null);
  };

  const insertBlocks = (blocks) => {
    if (!blocks.length) return;
    const nextBlocks = blocks.map((block) => ({
      ...block,
      id: `${block.id}-${crypto.randomUUID()}`,
    }));
    updateActiveProfile({ plan: [...plan, ...nextBlocks] });
  };

  const updateMinutes = (id, minutes) => {
    updateActiveProfile({
      plan: plan.map((block) =>
        block.id === id
          ? { ...block, minutes: Math.max(0, Math.min(999, Number(minutes) || 0)) }
          : block,
      ),
    });
  };

  const removeBlock = (id) => {
    updateActiveProfile({ plan: plan.filter((block) => block.id !== id) });
  };

  const moveBlock = (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const draggedIndex = plan.findIndex((block) => block.id === draggedId);
    const targetIndex = plan.findIndex((block) => block.id === targetId);
    if (draggedIndex < 0 || targetIndex < 0) return;
    const next = [...plan];
    const [dragged] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, dragged);
    updateActiveProfile({ plan: next });
  };

  const addProfile = () => {
    const next = makeProfile();
    setProfiles((current) => [...current, next]);
    setActiveProfileId(next.id);
    setSaveState('저장 안 됨');
  };

  const updateRouteField = (field, value) => {
    setRouteForm((current) => ({ ...current, [field]: value }));
  };

  const currentSearchPoint = startPlace
    ? `&lng=${encodeURIComponent(startPlace.lng)}&lat=${encodeURIComponent(startPlace.lat)}`
    : '';

  const searchPlaces = async (kind) => {
    const query = (kind === 'start' ? routeForm.startQuery : routeForm.endQuery).trim();
    if (!query) {
      setRouteState('검색어 필요');
      return;
    }
    setRouteState('장소 검색 중');
    try {
      const result = await apiRequest(
        `/api/places/search?query=${encodeURIComponent(query)}${kind === 'end' ? currentSearchPoint : ''}`,
      );
      if (kind === 'start') {
        setStartResults(result.places ?? []);
      } else {
        setEndResults(result.places ?? []);
      }
      setRouteState((result.places ?? []).length ? '장소 선택' : '검색 결과 없음');
    } catch {
      setRouteState('장소 검색 실패');
    }
  };

  const selectPlace = (kind, place) => {
    if (kind === 'start') {
      setStartPlace(place);
      setStartResults([]);
      setRouteForm((current) => ({ ...current, startQuery: place.name }));
    } else {
      setEndPlace(place);
      setEndResults([]);
      setRouteForm((current) => ({ ...current, endQuery: place.name }));
    }
    setRouteOptions([]);
    setRouteState('경로 조회 가능');
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setRouteState('현재 위치 불가');
      return;
    }
    setRouteState('현재 위치 확인 중');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const place = {
          id: 'current-location',
          name: '현재 위치',
          address: '브라우저 위치',
          road_address: '',
          category: 'GPS',
          lng: position.coords.longitude,
          lat: position.coords.latitude,
        };
        setStartPlace(place);
        setStartResults([]);
        setRouteForm((current) => ({ ...current, startQuery: '현재 위치' }));
        setRouteState('도착지 선택');
      },
      () => setRouteState('위치 권한 필요'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const fetchTransitRoute = async () => {
    if (!startPlace || !endPlace) {
      setRouteState('출발/도착 선택 필요');
      return;
    }
    const payload = {
      start_lng: Number(startPlace.lng),
      start_lat: Number(startPlace.lat),
      end_lng: Number(endPlace.lng),
      end_lat: Number(endPlace.lat),
      search_path_type: 0,
    };
    if (Object.values(payload).some((value) => Number.isNaN(value))) {
      setRouteState('좌표 확인 필요');
      return;
    }
    setRouteState('조회 중');
    try {
      const result = await apiRequest('/api/transit/estimate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const routes = result.routes ?? [];
      const shortestRoute = routes[0];
      if (!shortestRoute) {
        setRouteOptions([]);
        setRouteState('경로 없음');
        return;
      }
      insertBlocks(shortestRoute.blocks ?? []);
      setRouteOptions(routes.slice(1));
      setRouteState(`${shortestRoute.total_minutes}분 최단 경로 추가됨`);
    } catch {
      setRouteOptions([]);
      setRouteState('조회 실패');
    }
  };

  const removeProfile = async () => {
    if (!activeProfile) return;
    if (activeProfile.isNew) {
      const nextProfiles = profiles.filter((profile) => profile.id !== activeProfile.id);
      const fallbackProfile = makeProfile();
      setProfiles(nextProfiles.length > 0 ? nextProfiles : [fallbackProfile]);
      setActiveProfileId(nextProfiles[0]?.id ?? fallbackProfile.id);
      setSaveState('저장 안 됨');
      return;
    }
    setSaveState('삭제 중');
    try {
      await apiRequest(
        `/api/devices/${encodeURIComponent(deviceId)}/schedules/${encodeURIComponent(activeProfile.id)}`,
        { method: 'DELETE' },
      );
      const nextProfiles = profiles.filter((profile) => profile.id !== activeProfile.id);
      const fallbackProfile = makeProfile();
      setProfiles(nextProfiles.length > 0 ? nextProfiles : [fallbackProfile]);
      setActiveProfileId(nextProfiles[0]?.id ?? fallbackProfile.id);
      setSaveState(nextProfiles.length > 0 ? '저장됨' : '저장 안 됨');
    } catch {
      setSaveState('삭제 실패');
    }
  };

  const mobileCategory = categories.find((category) => category.id === mobileCategoryId);

  return (
    <main className="app">
      <section className="workspace">
        <aside className="palette" aria-label="시간 블록 팔레트">
          <div className="brand">
            <div className="brand-mark">
              <Clock3 size={24} />
            </div>
            <div>
              <h1>Timebomb</h1>
              <p>아침 루틴 시간 계산기</p>
            </div>
          </div>

          <div className="category-list">
            {categories.map((category) => {
              const Icon = category.icon;
              return (
                <section className="category" key={category.id}>
                  <div className="category-title" style={{ color: category.color }}>
                    <Icon size={18} />
                    <span>{category.name}</span>
                  </div>
                  <div className="block-buttons">
                    {category.blocks.map((label) => (
                      <button
                        className="palette-block"
                        key={label}
                        style={{ '--block-color': category.color, '--block-soft': category.soft }}
                        onClick={() => addBlock(category.id, label)}
                      >
                        <Plus size={15} />
                        <span>{label}</span>
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
            <div className="schedule-controls" aria-label="일정 관리">
              <input
                aria-label="일정 제목"
                placeholder="일정 제목"
                value={activeProfile?.name ?? ''}
                onChange={(event) => updateActiveProfile({ name: event.target.value })}
              />
              <button className="text-button" onClick={() => persistProfile()}>
                <Save size={18} />
                <span>저장하기</span>
              </button>
              <button className="text-button" onClick={removeProfile}>
                <Trash2 size={18} />
                <span>삭제하기</span>
              </button>
              <button className="icon-button" aria-label="새 일정" onClick={addProfile}>
                <Plus size={20} />
              </button>
              <button
                className="icon-button"
                aria-label="초기화"
                onClick={() => updateActiveProfile({ plan: [] })}
              >
                <RotateCcw size={20} />
              </button>
            </div>
          </div>

          <div className="schedule-list" aria-label="저장된 일정">
            {profiles.map((profile) => (
              <button
                className={`schedule-chip ${profile.id === activeProfile?.id ? 'is-active' : ''}`}
                key={profile.id}
                type="button"
                onClick={() => setActiveProfileId(profile.id)}
              >
                <strong>{profile.name || '제목 없음'}</strong>
                <span>{profile.plan?.length ?? 0}개 블록</span>
              </button>
            ))}
          </div>

          <div className="timeline">
            {plan.length === 0 ? (
              <div className="empty-state">왼쪽 블록을 눌러 루틴을 조립하세요.</div>
            ) : (
              plan.map((block, index) => {
                const category = getCategory(block.categoryId);
                return (
                  <article
                    className="time-block"
                    draggable
                    key={block.id}
                    onDragStart={() => setDraggedId(block.id)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      moveBlock(block.id);
                    }}
                    onDragEnd={() => setDraggedId(null)}
                    style={{ '--block-color': category.color, '--block-soft': category.soft }}
                  >
                    <span className="connector connector-top" aria-hidden="true" />
                    <div className="block-grip" aria-hidden="true">
                      <GripVertical size={18} />
                    </div>
                    <div className="block-index">{index + 1}</div>
                    <div className="block-main">
                      <strong>{block.label}</strong>
                      <span>{category.name}</span>
                    </div>
                    <label className="minute-field">
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={block.minutes}
                        onChange={(event) => updateMinutes(block.id, event.target.value)}
                      />
                      <span>분</span>
                    </label>
                    <button
                      className="delete-button"
                      aria-label={`${block.label} 삭제`}
                      onClick={() => removeBlock(block.id)}
                    >
                      <Trash2 size={18} />
                    </button>
                    <span className="connector connector-bottom" aria-hidden="true" />
                  </article>
                );
              })
            )}
          </div>
        </section>

        <aside className="summary" aria-label="총 시간">
          <div className="route-panel">
            <div className="alarm-title">
              <Train size={19} />
              <span>경로 가져오기</span>
            </div>
            <button className="wide-button secondary" type="button" onClick={useCurrentLocation}>
              <LocateFixed size={18} />
              현재 위치로 출발
            </button>
            <div className="place-search">
              <label className="time-field">
                <span>출발지</span>
                <div className="search-row">
                  <input
                    placeholder="예: 홍대입구역"
                    value={routeForm.startQuery}
                    onChange={(event) => {
                      updateRouteField('startQuery', event.target.value);
                      setStartPlace(null);
                    }}
                  />
                  <button type="button" onClick={() => searchPlaces('start')}>
                    <Search size={18} />
                  </button>
                </div>
              </label>
              {startPlace && <p className="selected-place">출발: {startPlace.name}</p>}
              {startResults.length > 0 && (
                <div className="place-results">
                  {startResults.map((place) => (
                    <button type="button" key={place.id} onClick={() => selectPlace('start', place)}>
                      <strong>{place.name}</strong>
                      <span>{place.road_address || place.address || place.category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="place-search">
              <label className="time-field">
                <span>도착지</span>
                <div className="search-row">
                  <input
                    placeholder="예: 강남역"
                    value={routeForm.endQuery}
                    onChange={(event) => {
                      updateRouteField('endQuery', event.target.value);
                      setEndPlace(null);
                    }}
                  />
                  <button type="button" onClick={() => searchPlaces('end')}>
                    <Search size={18} />
                  </button>
                </div>
              </label>
              {endPlace && <p className="selected-place">도착: {endPlace.name}</p>}
              {endResults.length > 0 && (
                <div className="place-results">
                  {endResults.map((place) => (
                    <button type="button" key={place.id} onClick={() => selectPlace('end', place)}>
                      <strong>{place.name}</strong>
                      <span>{place.road_address || place.address || place.category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="wide-button" type="button" onClick={fetchTransitRoute}>
              최단 경로 보드에 추가
            </button>
            <p className="route-state">{routeState}</p>
            {routeOptions.length > 0 && (
              <div className="route-options">
                {routeOptions.map((route, index) => (
                  <button
                    className="route-option"
                    type="button"
                    key={`${route.title}-${index}`}
                    onClick={() => insertBlocks(route.blocks ?? [])}
                  >
                    <strong>{route.total_minutes}분</strong>
                    <span>대안 경로 {index + 2} · {route.blocks?.length ?? 0}개 블록 추가</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="alarm-panel">
            <div className="alarm-title">
              <AlarmClock size={19} />
              <span>알람 계산</span>
            </div>
            <label className="time-field">
              <span>도착 목표</span>
              <input
                type="time"
                value={targetTime}
                onChange={(event) => updateActiveProfile({ targetTime: event.target.value })}
              />
            </label>
            <label className="time-field">
              <span>여유 시간</span>
              <div className="buffer-input">
                <input
                  type="number"
                  min="0"
                  max="240"
                  value={bufferMinutes}
                  onChange={(event) =>
                    updateActiveProfile({
                      bufferMinutes: Math.max(0, Math.min(240, Number(event.target.value) || 0)),
                    })
                  }
                />
                <span>분</span>
              </div>
            </label>
            <div className="alarm-result">
              <span>{alarm.dayLabel} 알람</span>
              <strong>{alarm.time}</strong>
            </div>
          </div>

          <div className="total-panel">
            <p>총 소요 시간</p>
            <strong>{formatDuration(totalMinutes)}</strong>
            <span>여유 포함 {alarm.requiredMinutes}분</span>
          </div>
          <div className="breakdown">
            {categories.map((category) => {
              const subtotal = plan
                .filter((block) => block.categoryId === category.id)
                .reduce((sum, block) => sum + (Number(block.minutes) || 0), 0);
              return (
                <div className="breakdown-row" key={category.id}>
                  <span className="dot" style={{ backgroundColor: category.color }} />
                  <span>{category.name}</span>
                  <strong>{subtotal}분</strong>
                </div>
              );
            })}
          </div>
        </aside>
      </section>

      <button
        className="mobile-palette-button"
        type="button"
        aria-label="블록 메뉴 열기"
        onClick={() => setIsMobilePaletteOpen(true)}
      >
        <Menu size={22} />
        <span>블록</span>
      </button>

      {isMobilePaletteOpen && (
        <div className="mobile-palette-shell" role="dialog" aria-modal="true">
          <button
            className="mobile-palette-backdrop"
            type="button"
            aria-label="블록 메뉴 닫기"
            onClick={() => {
              setIsMobilePaletteOpen(false);
              setMobileCategoryId(null);
            }}
          />
          <section className="mobile-palette-sheet" aria-label="모바일 블록 메뉴">
            <div className="mobile-sheet-header">
              {mobileCategory ? (
                <button
                  className="sheet-icon-button"
                  type="button"
                  aria-label="카테고리로 돌아가기"
                  onClick={() => setMobileCategoryId(null)}
                >
                  <ChevronLeft size={22} />
                </button>
              ) : (
                <div className="sheet-spacer" />
              )}
              <strong>{mobileCategory?.name ?? '블록 선택'}</strong>
              <button
                className="sheet-icon-button"
                type="button"
                aria-label="블록 메뉴 닫기"
                onClick={() => {
                  setIsMobilePaletteOpen(false);
                  setMobileCategoryId(null);
                }}
              >
                <X size={22} />
              </button>
            </div>

            {mobileCategory ? (
              <div className="mobile-block-list">
                {mobileCategory.blocks.map((label) => (
                  <button
                    className="palette-block"
                    key={label}
                    style={{
                      '--block-color': mobileCategory.color,
                      '--block-soft': mobileCategory.soft,
                    }}
                    type="button"
                    onClick={() => addBlock(mobileCategory.id, label)}
                  >
                    <Plus size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mobile-category-list">
                {categories.map((category) => {
                  const Icon = category.icon;
                  return (
                    <button
                      className="mobile-category-button"
                      key={category.id}
                      type="button"
                      style={{ '--block-color': category.color, '--block-soft': category.soft }}
                      onClick={() => setMobileCategoryId(category.id)}
                    >
                      <Icon size={20} />
                      <span>{category.name}</span>
                      <strong>{category.blocks.length}</strong>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

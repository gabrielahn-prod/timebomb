import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlarmClock,
  Bath,
  Bus,
  Clock3,
  GripVertical,
  Home,
  Plus,
  RotateCcw,
  Sparkles,
  Train,
  Trash2,
} from 'lucide-react';
import './styles.css';

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

function App() {
  const [plan, setPlan] = useState(starterPlan);
  const [draggedId, setDraggedId] = useState(null);
  const [targetTime, setTargetTime] = useState('09:00');
  const [bufferMinutes, setBufferMinutes] = useState(10);

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
    setPlan((current) => [...current, makeBlock(categoryId, label)]);
  };

  const updateMinutes = (id, minutes) => {
    setPlan((current) =>
      current.map((block) =>
        block.id === id
          ? { ...block, minutes: Math.max(0, Math.min(999, Number(minutes) || 0)) }
          : block,
      ),
    );
  };

  const removeBlock = (id) => {
    setPlan((current) => current.filter((block) => block.id !== id));
  };

  const moveBlock = (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    setPlan((current) => {
      const draggedIndex = current.findIndex((block) => block.id === draggedId);
      const targetIndex = current.findIndex((block) => block.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [dragged] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, dragged);
      return next;
    });
  };

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
              <p className="eyebrow">블록을 눌러 추가하고 시간을 입력하세요</p>
              <h2>출발 전 루틴</h2>
            </div>
            <button className="icon-button" aria-label="초기화" onClick={() => setPlan([])}>
              <RotateCcw size={20} />
            </button>
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
                onChange={(event) => setTargetTime(event.target.value)}
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
                    setBufferMinutes(Math.max(0, Math.min(240, Number(event.target.value) || 0)))
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
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

import React, { useState, useEffect, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/react';
import { statsChartOutline, peopleOutline, starOutline, trendingUpOutline } from 'ionicons/icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { firestore } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import './Analytics.css';

interface MonthPoint {
  key: string;
  label: string;
  sessions: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildTrailingMonths(): { key: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 12 }).map((_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    return {
      key: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
      label: MONTH_LABELS[month.getMonth()],
    };
  });
}

const SessionsLineChart: React.FC<{ points: MonthPoint[] }> = ({ points }) => {
  const W = 700;
  const H = 220;
  const PAD = 32;
  const max = Math.max(1, ...points.map((p) => p.sessions));

  const coords = points.map((p, index) => {
    const x = PAD + (index * (W - PAD * 2)) / Math.max(1, points.length - 1);
    const y = H - PAD - (p.sessions / max) * (H - PAD * 2);
    return { x, y, p };
  });

  const linePath = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x} ${coord.y}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${H - PAD} L ${coords[0].x} ${H - PAD} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="analytics-linechart" role="img" aria-label="Sessions per month">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="chart-axis" />
      <path d={areaPath} className="chart-area" />
      <path d={linePath} className="chart-line" />
      {coords.map((coord, index) => (
        <g key={coord.p.key}>
          <circle cx={coord.x} cy={coord.y} r={4} className="chart-dot" />
          <text x={coord.x} y={H - PAD + 18} className="chart-x-label">
            {coord.p.label}
          </text>
          {coord.p.sessions > 0 && (
            <text x={coord.x} y={coord.y - 10} className="chart-point-label">
              {coord.p.sessions}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

const TourGuideAnalytics: React.FC = () => {
  const history = useHistory();
  const { currentUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      try {
        const sessionsSnap = await getDocs(
          query(collection(firestore, 'sessions'), where('guideId', '==', currentUser.uid))
        );
        const feedbackSnap = await getDocs(
          query(collection(firestore, 'feedback'), where('guideId', '==', currentUser.uid))
        );

        if (cancelled) return;

        setSessions(sessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setFeedback(feedbackSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error('[Analytics] load failed:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid]);

  const totalSessions = sessions.length;

  const touristsServed = useMemo(() => {
    const uids = new Set<string>();
    sessions.forEach((session) => {
      const tourists = Array.isArray(session.tourists) ? session.tourists : [];
      tourists.forEach((tourist: any) => {
        if (tourist?.uid) uids.add(tourist.uid);
      });
    });
    return uids.size;
  }, [sessions]);

  const avgRating = useMemo(() => {
    if (feedback.length === 0) return null;
    const sum = feedback.reduce((acc, item) => acc + (Number(item.rating) || 0), 0);
    return feedback.length > 0 ? sum / feedback.length : null;
  }, [feedback]);

  const monthlyPoints = useMemo<MonthPoint[]>(() => {
    const trailing = buildTrailingMonths();
    const counts = new Map<string, number>(trailing.map((m) => [m.key, 0]));

    sessions.forEach((session) => {
      const rawDate = session.startTime || session.createdAt;
      if (!rawDate) return;
      let date: Date | null = null;
      if (rawDate?.toDate) date = rawDate.toDate();
      else if (typeof rawDate === 'string' || typeof rawDate === 'number') date = new Date(rawDate);
      if (!date || Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    });

    return trailing.map((month) => ({ key: month.key, label: month.label, sessions: counts.get(month.key) || 0 }));
  }, [sessions]);

  return (
    <IonPage>
      <IonHeader className="ga-header">
        <IonToolbar>
          <div onClick={() => history.goBack()} className="ga-back-btn" role="button" tabIndex={0}>
            ‹
          </div>
          <IonTitle className="ga-title">MY ANALYTICS</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ga-content">
        {loading ? (
          <div className="ga-loading">
            <IonSpinner name="crescent" />
            <p>Crunching your tour numbers…</p>
          </div>
        ) : (
          <div className="ga-wrapper">
            <div className="ga-stats-grid">
              <div className="ga-stat-card">
                <div className="ga-stat-icon sessions">
                  <IonIcon icon={statsChartOutline} />
                </div>
                <div className="ga-stat-details">
                  <span className="ga-stat-label">Total Sessions</span>
                  <span className="ga-stat-number">{totalSessions}</span>
                </div>
              </div>

              <div className="ga-stat-card">
                <div className="ga-stat-icon tourists">
                  <IonIcon icon={peopleOutline} />
                </div>
                <div className="ga-stat-details">
                  <span className="ga-stat-label">Tourists Served</span>
                  <span className="ga-stat-number">{touristsServed}</span>
                </div>
              </div>

              <div className="ga-stat-card">
                <div className="ga-stat-icon rating">
                  <IonIcon icon={starOutline} />
                </div>
                <div className="ga-stat-details">
                  <span className="ga-stat-label">Average Rating</span>
                  <span className="ga-stat-number">
                    {avgRating !== null ? avgRating.toFixed(1) : '—'}
                  </span>
                  <span className="ga-stat-sub">
                    {feedback.length} review{feedback.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="ga-card">
              <div className="ga-card-header">
                <IonIcon icon={trendingUpOutline} />
                <h4>Sessions Per Month</h4>
                <span className="ga-badge">Last 12 months</span>
              </div>
              {totalSessions === 0 ? (
                <p className="ga-empty">No sessions recorded yet — this chart will fill in as you run tours.</p>
              ) : (
                <SessionsLineChart points={monthlyPoints} />
              )}
            </div>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default TourGuideAnalytics;

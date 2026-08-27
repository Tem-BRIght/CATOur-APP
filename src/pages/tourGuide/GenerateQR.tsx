import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonButton, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonPage,
  IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToast, IonToolbar,
} from '@ionic/react';
import {
  arrowBackOutline, calendarClearOutline, checkmarkCircleOutline, listOutline,
  refreshOutline, timeOutline,
} from 'ionicons/icons';
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firestore } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { getOrCreateSessionForSlot } from '../../services/sessionService';
import { resolveGuideTourTypeIds } from '../../services/tourScheduleService';
import './GenerateQR.css';

type TourType = { id: string; name: string };
type Slot = { date: string; startTime: string; endTime: string; maxSpots?: number; sessionCount?: number; bookedCount?: number };

const normalizeDateValue = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return trimmed;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return '';
};

const isSlotWithinQrWindow = (slot: Slot, now: number) => {
  const startMs = new Date(`${slot.date}T${slot.startTime}:00`).getTime();
  const endMs = new Date(`${slot.date}T${slot.endTime}:00`).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;

  // Keep all valid, non-expired slots visible and allow QR generation until
  // the slot's end time actually passes.
  return now <= endMs;
};

const getSlotCapacity = (slot: any) => {
  const maxSpots = Number(slot?.maxSpots ?? 10);
  const sessionCount = Number(slot?.sessionCount ?? slot?.bookedCount ?? slot?.joinedUserIds?.length ?? 0);
  return { maxSpots, sessionCount };
};

const buildQRUrl = (data: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(data)}&color=0d2f6e&bgcolor=ffffff&ecc=H&margin=10`;

const GenerateQR: React.FC = () => {
  const history = useHistory();
  const { currentUser } = useAuth();
  const [tourTypes, setTourTypes] = useState<TourType[]>([]);
  const [selectedTourTypeId, setSelectedTourTypeId] = useState('');
  const [slotsToday, setSlotsToday] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [nextSlot, setNextSlot] = useState<Slot | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [hasSlotToday, setHasSlotToday] = useState(false);
  const [allSlotsExpiredToday, setAllSlotsExpiredToday] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [expiresIn, setExpiresIn] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    const loadGuideData = async () => {
      try {
        const guideSnap = await getDoc(doc(firestore, 'tourGuides', currentUser.uid));
        if (!guideSnap.exists()) {
          setToastMsg('Guide profile not found.');
          return;
        }
        const data = guideSnap.data();
        setDestinationId(data.assignedDestId || '');
        setDestinationName(data.assignedDestName || '');

        const tourTypeMap = new Map<string, { destinationIds: string[] }>();
        const typeSnap = await getDocs(collection(firestore, 'tourTypes'));
        typeSnap.docs.forEach((item) => {
          const itemData = item.data();
          tourTypeMap.set(item.id, {
            destinationIds: Array.isArray(itemData.destinations) ? itemData.destinations : [],
          });
        });

        const typeIds = resolveGuideTourTypeIds(data, tourTypeMap);
        const resolvedTypeIds = typeIds.length > 0 ? typeIds : (data.tourTypeIds || []);

        if (resolvedTypeIds.length) {
          const typeSnapFiltered = await getDocs(query(collection(firestore, 'tourTypes'), where(documentId(), 'in', resolvedTypeIds.slice(0, 30))));
          const types = typeSnapFiltered.docs.map((item) => ({ id: item.id, name: item.data().name || 'Unnamed' }));
          setTourTypes(types);
          setSelectedTourTypeId(types[0]?.id || '');
        } else {
          const allTypes = typeSnap.docs.map((item) => ({ id: item.id, name: item.data().name || 'Unnamed' }));
          setTourTypes(allTypes);
          setSelectedTourTypeId(allTypes[0]?.id || '');
        }

        const normalizedSlots: Slot[] = (data.availabilitySlots || [])
          .map((slot: any) => {
            const { maxSpots, sessionCount } = getSlotCapacity(slot);
            const date = normalizeDateValue(slot?.date ?? slot?.tourDate);
            const startTime = slot?.startTime || '00:00';
            const endTime = slot?.endTime || '23:59';
            if (!date || !startTime || !endTime) return null;
            if (sessionCount >= maxSpots) return null;
            return {
              date,
              startTime,
              endTime,
              maxSpots,
              sessionCount,
            };
          })
          .filter(Boolean) as Slot[];

        const sortedSlots = normalizedSlots.sort((a, b) => {
          const dateCompare = (a.date || '').localeCompare(b.date || '');
          if (dateCompare !== 0) return dateCompare;
          return (a.startTime || '').localeCompare(b.startTime || '');
        });

        const now = Date.now();
        const today = new Date().toLocaleDateString('en-CA');
        const activeSlots = sortedSlots.filter((slot) =>
          slot.date === today && isSlotWithinQrWindow(slot, now)
        );

        if (activeSlots.length > 0) {
          const firstActive = {
            date: activeSlots[0].date,
            startTime: activeSlots[0].startTime || '00:00',
            endTime: activeSlots[0].endTime || '23:59',
          };
          setNextSlot(firstActive);
          setSelectedSlot(firstActive);
          setSlotsToday(activeSlots);
          setHasSlotToday(true);
          setAllSlotsExpiredToday(false);
        } else {
          setNextSlot(null);
          setSelectedSlot(null);
          setSlotsToday([]);
          setHasSlotToday(false);
          setAllSlotsExpiredToday(sortedSlots.length > 0);
        }
      } catch (err) {
        console.error('Failed to load guide data:', err);
        setToastMsg('Could not load your tour data.');
      } finally {
        setIsLoading(false);
      }
    };
    loadGuideData();
  }, [currentUser]);

  const generateQR = async () => {
    const activeSlot = selectedSlot || nextSlot;
    if (!currentUser || !activeSlot || !selectedTourTypeId || !destinationId) return;
    const selectedType = tourTypes.find((type) => type.id === selectedTourTypeId);
    if (!selectedType) return;
    setIsLoading(true);
    try {
      const guideSnap = await getDoc(doc(firestore, 'tourGuides', currentUser.uid));
      const guide = guideSnap.data();
      const guideName = `${guide?.firstName || ''} ${guide?.lastName || ''}`.trim() || 'Tour Guide';
      const session = await getOrCreateSessionForSlot({
        destinationId, destinationName, tourTypeId: selectedType.id, tourTypeName: selectedType.name,
        guideId: currentUser.uid, guideName, date: activeSlot.date, startTime: activeSlot.startTime, endTime: activeSlot.endTime,
      });
      setSessionId(session.id);
      setQrUrl(buildQRUrl(session.id));
      const endMs = new Date(session.endTime || `${activeSlot.date}T${activeSlot.endTime}:00`).getTime();
      setExpiresIn(Math.max(0, Math.floor((endMs - Date.now()) / 1000)));
    } catch (err) {
      console.error('Failed to generate QR:', err);
      setToastMsg('Failed to create session. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedTourTypeId && destinationId && (selectedSlot || nextSlot)) generateQR();
  }, [selectedTourTypeId, destinationId, selectedSlot, nextSlot]);

  useEffect(() => {
    const interval = setInterval(() => setExpiresIn((prev) => (prev <= 1 ? 0 : prev - 1)), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return hours ? `${hours}:${minutes}:${remainingSeconds}` : `${minutes}:${remainingSeconds}`;
  };
  const isExpired = expiresIn === 0;

  return <IonPage>
    <IonHeader className="ion-no-border"><IonToolbar className="generate-header">
      <div onClick={() => history.goBack()} className="gen-back-button"><IonIcon icon={arrowBackOutline} /></div>
      <IonTitle className="generate-title">GENERATE QR</IonTitle>
    </IonToolbar></IonHeader>
    <IonContent className="generate-content"><div className="generate-wrapper">
      <div className="gen-instruction"><p>Select a tour type, then share the QR code with your tourists.</p></div>
      {!hasSlotToday ? <div className="qr-card"><div className="qr-expired-overlay"><IonIcon icon={calendarClearOutline} />
        <p>{allSlotsExpiredToday ? 'No tours available today' : 'No active tour'}</p><span>{allSlotsExpiredToday ? 'This tour slot has already end.' : 'QR is available until the tour ends.'}</span>
      </div></div> : <>
        <div style={{ margin: '12px 0 8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {slotsToday.map((slot) => {
            const selected = selectedSlot?.date === slot.date && selectedSlot?.startTime === slot.startTime && selectedSlot?.endTime === slot.endTime;
            return (
              <button
                key={`${slot.date}-${slot.startTime}-${slot.endTime}`}
                type="button"
                onClick={() => setSelectedSlot(slot)}
                style={{
                  border: selected ? '2px solid #0d2f6e' : '1px solid #d2d9e5',
                  borderRadius: '12px',
                  background: selected ? '#eaf1ff' : '#fff',
                  padding: '12px 14px',
                  textAlign: 'left',
                  fontSize: '14px',
                  color: '#133a61',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {slot.startTime} - {slot.endTime}
              </button>
            );
          })}
        </div>

        <IonItem lines="none"><IonLabel>Tour Type</IonLabel><IonSelect value={selectedTourTypeId} onIonChange={(event) => setSelectedTourTypeId(event.detail.value)}>
          {tourTypes.map((type) => <IonSelectOption key={type.id} value={type.id}>{type.name}</IonSelectOption>)}
        </IonSelect></IonItem>
        <div className={`qr-card ${isExpired ? 'expired' : ''}`}><div className="qr-card-inner">
          {isLoading ? <div className="qr-loading"><IonSpinner name="crescent" /><p>Generating QR...</p></div>
            : isExpired ? <div className="qr-expired-overlay"><IonIcon icon={timeOutline} /><p>QR Expired</p><span>Tap refresh to generate a new one</span></div>
            : <img src={qrUrl} alt="Session QR Code" className="qr-image" />}
        </div>{!isLoading && <div className={`qr-timer ${expiresIn <= 300 ? 'warning' : ''} ${isExpired ? 'expired-timer' : ''}`}><IonIcon icon={timeOutline} /><span>{isExpired ? 'Tour ended' : `Ends in ${formatTime(expiresIn)}`}</span></div>}</div>
        {!isLoading && <div className="session-badge"><IonIcon icon={checkmarkCircleOutline} /><span>Session ID: {sessionId}</span></div>}
        <IonButton expand="block" className="view-list-btn" routerLink={`/tourguide/list/${sessionId}`} disabled={!sessionId || isLoading || isExpired}><IonIcon icon={listOutline} slot="start" />{isExpired ? 'Tour Ended' : 'View List'}</IonButton>
        <IonButton expand="block" fill="outline" className="view-list-btn" onClick={generateQR} style={{ marginTop: '8px' }}><IonIcon icon={refreshOutline} slot="start" />Refresh QR</IonButton>
      </>}
    </div></IonContent>
    <IonToast isOpen={!!toastMsg} message={toastMsg} duration={3000} position="bottom" onDidDismiss={() => setToastMsg('')} />
  </IonPage>;
};

export default GenerateQR;

import React, { useState } from 'react';
import {
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonPopover,
  IonRadio,
  IonRadioGroup,
} from '@ionic/react';

type OtherSelectProps = {
  label: string;
  options: string[];
  value: string;
  otherValue: string;
  onChange: (value: string) => void;
  onOtherChange: (value: string) => void;
};

const OtherSelect: React.FC<OtherSelectProps> = ({
  label,
  options,
  value,
  otherValue,
  onChange,
  onOtherChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = value === 'other' || value === 'Other'
    ? otherValue || 'Other'
    : value || `Select ${label.toLowerCase()}`;

  const handleChange = (selectedValue: string) => {
    onChange(selectedValue);
    if (selectedValue !== 'other' && selectedValue !== 'Other') {
      setIsOpen(false);
    }
  };

  return (
    <>
      <IonLabel position="stacked" className="signup-3-label">{label} *</IonLabel>
      <IonButton
        id={`select-${label.toLowerCase()}`}
        fill="outline"
        expand="block"
        className="other-select-trigger"
        onClick={() => setIsOpen(true)}
      >
        {selectedLabel}
      </IonButton>
      <IonPopover
        trigger={`select-${label.toLowerCase()}`}
        isOpen={isOpen}
        onDidDismiss={() => setIsOpen(false)}
        onWillPresent={() => setIsOpen(true)}
      >
        <IonRadioGroup value={value} onIonChange={(event) => handleChange(event.detail.value)}>
          {options.filter(option => option !== 'Other').map(option => (
            <IonItem key={option} lines="none" button onClick={() => handleChange(option)}>
              <IonRadio slot="start" value={option} />
              <IonLabel>{option}</IonLabel>
            </IonItem>
          ))}
          <IonItem lines="none">
            <IonRadio
              slot="start"
              value={label === 'Nationality' ? 'other' : 'Other'}
              onClick={() => onChange(label === 'Nationality' ? 'other' : 'Other')}
            />
            <IonLabel>Other</IonLabel>
            <IonInput
              placeholder="Type here"
              value={otherValue}
              onIonChange={(event) => {
                const otherOption = label === 'Nationality' ? 'other' : 'Other';
                onChange(otherOption);
                onOtherChange(event.detail.value ?? '');
              }}
              onClick={() => onChange(label === 'Nationality' ? 'other' : 'Other')}
            />
          </IonItem>
        </IonRadioGroup>
      </IonPopover>
    </>
  );
};

export default OtherSelect;

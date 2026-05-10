import React from 'react';
import { AlertTriangle, X, MapPin, Clock } from 'lucide-react';
import { useAlert } from '@/contexts/AlertContext';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const EmergencyAlert: React.FC = () => {
  const { showEmergency, currentAlert, dismissEmergency } = useAlert();

  if (!showEmergency || !currentAlert) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-[calc(100%-2rem)] bg-card rounded-xl overflow-hidden emergency-breathing">
        <div className="flex items-center justify-between bg-destructive px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-destructive-foreground" />
            <span className="text-base font-bold text-destructive-foreground">紧急警报</span>
          </div>
          <button
            onClick={dismissEmergency}
            className="p-1 rounded-full hover:bg-white/20 active:opacity-70"
          >
            <X className="w-5 h-5 text-destructive-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Clock className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span>
              {format(new Date(currentAlert.created_at), 'yyyy年MM月dd日 HH:mm:ss', { locale: zhCN })}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <MapPin className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span>{currentAlert.location}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">确认姿态：</span>
            <span className="font-semibold text-destructive">{currentAlert.posture}</span>
          </div>

          {currentAlert.image_url && (
            <div className="aspect-video w-full rounded-lg overflow-hidden bg-muted">
              <img
                src={currentAlert.image_url}
                alt="跌倒画面"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <p className="text-sm text-muted-foreground text-center">
            检测到确认跌倒事件，请立即查看并采取相应措施
          </p>

          <button
            onClick={dismissEmergency}
            className="w-full h-11 bg-destructive text-destructive-foreground rounded-lg font-semibold text-sm active:opacity-70 transition-opacity"
          >
            我已知晓
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmergencyAlert;

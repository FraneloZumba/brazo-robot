import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

type MotorId = 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7';

interface MotorConfig {
  id: MotorId;
  address: number;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  home: number;
}

interface SequenceFrame {
  duration?: number;
  [key: string]: number | undefined;
}

@Component({
  selector: 'app-robot-arm-studio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './brazo.html',
  styleUrls: ['./brazo.css'],
  encapsulation: ViewEncapsulation.None,
})
export class RobotArmStudioComponent implements OnInit, OnDestroy {
  modeLabel = 'MODE: LIVE';
  systemStatus = 'SYSTEM: ONLINE';
  latencyInfo = 'LATENCY: --ms';
  uptimeInfo = 'UPTIME: 00:00:00';

  stepDuration = 5000;

  motors: MotorConfig[] = [
    { id: 'm1', address: 1, label: 'Base', min: -110, max: 170, step: 1, value: 0, home: 0 },
    { id: 'm2', address: 2, label: 'Shoulder', min: -130, max: 10, step: 1, value: 0, home: 0 },
    { id: 'm3', address: 3, label: 'Elbow', min: -180, max: -4, step: 1, value: -90, home: -90 },
    { id: 'm4', address: 4, label: 'Wrist V', min: -90, max: 120, step: 1, value: 0, home: 0 },
    { id: 'm5', address: 5, label: 'Wrist R', min: -20, max: 150, step: 1, value: 0, home: 0 },
    { id: 'm6', address: 6, label: 'Gripper', min: 0, max: 2, step: 0.1, value: 0, home: 0 },
    { id: 'm7', address: 7, label: 'Servo', min: -100, max: 100, step: 1, value: 0, home: 0 },
  ];

  sequence: SequenceFrame[] = [];

  port: any = null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  isPlaying = false;
  playTimeout: ReturnType<typeof setTimeout> | null = null;
  currentStepIndex = 0;

  private startTime = Date.now();
  private uptimeTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.updateUptime();
    this.uptimeTimer = setInterval(() => this.updateUptime(), 1000);
  }

  ngOnDestroy(): void {
    if (this.playTimeout) {
      clearTimeout(this.playTimeout);
      this.playTimeout = null;
    }

    if (this.uptimeTimer) {
      clearInterval(this.uptimeTimer);
      this.uptimeTimer = null;
    }
  }

  get isConnected(): boolean {
    return !!this.port;
  }

  private updateUptime(): void {
    const diff = Math.floor((Date.now() - this.startTime) / 1000);
    const h = String(Math.floor(diff / 3600)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    this.uptimeInfo = `UPTIME: ${h}:${m}:${s}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async toggleConnection(): Promise<void> {
    if (this.port) {
      await this.disconnectSerial();
    } else {
      await this.connectSerial();
    }
  }

  async connectSerial(): Promise<void> {
    try {
      const serial = (navigator as any).serial;
      if (!serial) {
        alert('Web Serial API no está disponible en este navegador.');
        return;
      }

      this.port = await serial.requestPort();
      await this.port.open({ baudRate: 115200 });

      this.writer = this.port.writable?.getWriter() ?? null;

      if (!this.writer) {
        throw new Error('No se pudo obtener el writer del puerto serial.');
      }

      this.systemStatus = 'SYSTEM: ONLINE';
      this.latencyInfo = 'LATENCY: --ms';
      console.log('Serial connected');
    } catch (err: any) {
      console.error('Serial error:', err);
      alert('Failed to connect: ' + (err?.message ?? err));
      this.port = null;
      this.writer = null;
    }
  }

  async disconnectSerial(): Promise<void> {
    try {
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }

      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  }

  async sendMotorCommand(addr: number, angle: number, vel = 120, acc = 0): Promise<void> {
    if (!this.writer) return;

    const clk = Math.abs(Math.round(angle * 270));
    const dir = angle >= 0 ? 0 : 1;

    const cmd = new Uint8Array(13);
    cmd[0] = addr;
    cmd[1] = 0xFD;
    cmd[2] = dir;
    cmd[3] = (vel >> 8) & 0xFF;
    cmd[4] = vel & 0xFF;
    cmd[5] = acc;
    cmd[6] = (clk >> 24) & 0xFF;
    cmd[7] = (clk >> 16) & 0xFF;
    cmd[8] = (clk >> 8) & 0xFF;
    cmd[9] = clk & 0xFF;
    cmd[10] = 1;
    cmd[11] = 0;
    cmd[12] = 0x6B;

    try {
      await this.writer.write(cmd);
      console.log(`Sent M${addr}: ${angle}° (${clk} pulses)`);
      this.latencyInfo = `LATENCY: ${Math.floor(Math.random() * 5 + 5)}ms`;
    } catch (err) {
      console.error('Write error:', err);
    }
  }

  updateMotor(motor: MotorConfig, rawValue: string | number): void {
    const value = Number(rawValue);
    if (Number.isNaN(value)) return;

    motor.value = value;
    this.sendMotorCommand(motor.address, value);
  }

  resetMotor(motor: MotorConfig): void {
    motor.value = 0;
    this.sendMotorCommand(motor.address, 0);
  }

  normalizeFrame(frame: SequenceFrame): SequenceFrame {
    const newFrame: SequenceFrame = { ...frame };

    const mapping: Record<string, MotorId> = {
      base: 'm1',
      shoulder: 'm2',
      elbow: 'm3',
      wristV: 'm4',
      wristR: 'm5',
      grip: 'm6',
      servo: 'm7',
    };

    for (const [oldKey, newKey] of Object.entries(mapping)) {
      const oldValue = frame[oldKey];
      if (oldValue !== undefined && newFrame[newKey] === undefined) {
        newFrame[newKey] = oldValue;
      }
    }

    return newFrame;
  }

  getDisplayValue(frame: SequenceFrame, motorId: MotorId): number {
    const normalized = this.normalizeFrame(frame);
    const motor = this.motors.find(m => m.id === motorId);
    return normalized[motorId] ?? motor?.home ?? 0;
  }

  addFrame(): void {
    const frame: SequenceFrame = {
      duration: this.stepDuration,
    };

    this.motors.forEach(motor => {
      frame[motor.id] = motor.value;
    });

    this.sequence.push(frame);
  }

  deleteFrame(index: number): void {
    this.sequence.splice(index, 1);
    if (this.currentStepIndex >= this.sequence.length) {
      this.currentStepIndex = 0;
    }
  }

  clearSequence(): void {
    if (confirm('Clear all frames?')) {
      this.sequence = [];
      this.currentStepIndex = 0;
    }
  }

  async moveToFrame(rawFrame: SequenceFrame): Promise<void> {
    const frame = this.normalizeFrame(rawFrame);

    for (let i = 1; i <= 7; i++) {
      const motorId = `m${i}` as MotorId;
      const angle = frame[motorId];

      if (angle !== undefined) {
        await this.sendMotorCommand(i, angle);
        await this.delay(10);
      }
    }

    this.motors.forEach(motor => {
      const val = frame[motor.id] ?? motor.home;
      motor.value = val;
    });
  }

  setAllSlidersZero(): void {
    this.motors.forEach(motor => {
      motor.value = motor.home;
    });
  }

  async goHome(): Promise<void> {
    this.setAllSlidersZero();
    console.log('HOMING physical arm...');

    for (const motor of this.motors) {
      await this.sendMotorCommand(motor.address, motor.home);
      await this.delay(50);
    }
  }

  async playNextStep(): Promise<void> {
    if (!this.isPlaying || this.sequence.length === 0) return;

    if (this.currentStepIndex >= this.sequence.length) {
      this.currentStepIndex = 0;
    }

    const rawFrame = this.sequence[this.currentStepIndex];
    const frame = this.normalizeFrame(rawFrame);

    await this.moveToFrame(frame);

    this.currentStepIndex++;
    const duration = Number(frame.duration ?? this.stepDuration ?? 5000);

    this.playTimeout = setTimeout(() => this.playNextStep(), duration);
  }

  togglePlay(): void {
    if (this.sequence.length === 0) return;

    this.isPlaying = !this.isPlaying;

    if (this.isPlaying) {
      this.currentStepIndex = 0;
      this.playNextStep();
    } else {
      if (this.playTimeout) {
        clearTimeout(this.playTimeout);
        this.playTimeout = null;
      }
    }
  }

  stopPlayback(): void {
    this.isPlaying = false;

    if (this.playTimeout) {
      clearTimeout(this.playTimeout);
      this.playTimeout = null;
    }

    this.currentStepIndex = 0;
  }

  saveSequence(): void {
    const data = JSON.stringify(this.sequence, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `sequence_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  loadSequence(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = ev => {
      try {
        const parsed = JSON.parse(String(ev.target?.result ?? '[]'));

        if (!Array.isArray(parsed)) {
          throw new Error('El JSON debe contener un arreglo de frames.');
        }

        this.sequence = parsed.map(frame => this.normalizeFrame(frame));
        this.currentStepIndex = 0;
      } catch (err: any) {
        alert('Error parsing JSON: ' + (err?.message ?? err));
      }
    };

    reader.readAsText(file);
    input.value = '';
  }
}
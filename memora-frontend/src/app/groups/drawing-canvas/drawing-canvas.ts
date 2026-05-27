import {
  Component, ElementRef, ViewChild, Output, EventEmitter, AfterViewInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

const COLORS = [
  '#1a1a1a', '#ffffff', '#f5f0e8', '#8B5E3C', '#4CAF50',
  '#FFD700', '#e53935', '#1565C0', '#F48FB1', '#E91E63',
  '#FF7043', '#7B1FA2', '#00BCD4', '#607D8B', '#A5D6A7',
];

const SIZES = [2, 5, 10, 18, 28];

@Component({
  selector: 'app-drawing-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './drawing-canvas.html',
  styleUrls: ['./drawing-canvas.css']
})
export class DrawingCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @Output() exported = new EventEmitter<File>();

  colors = COLORS;
  sizes = SIZES;
  selectedColor = '#1a1a1a';
  selectedSize = 5;
  tool: 'pen' | 'eraser' | 'text' = 'pen';

  textValue = '';
  textX = 0;
  textY = 0;
  showTextInput = false;

  private ctx!: CanvasRenderingContext2D;
  private drawing = false;
  private lastX = 0;
  private lastY = 0;

  private readonly CANVAS_W = 800;
  private readonly CANVAS_H = 560;

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    canvas.width = this.CANVAS_W;
    canvas.height = this.CANVAS_H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.CANVAS_W, this.CANVAS_H);
  }

  ngOnDestroy() {}

  // ── Mouse events ──────────────────────────────────────────────

  onMouseDown(e: MouseEvent) {
    if (this.tool === 'text') {
      this.placeTextInput(e.offsetX, e.offsetY);
      return;
    }
    this.drawing = true;
    [this.lastX, this.lastY] = [e.offsetX, e.offsetY];
  }

  onMouseMove(e: MouseEvent) {
    if (!this.drawing) return;
    this.drawSegment(e.offsetX, e.offsetY);
  }

  onMouseUp() { this.drawing = false; }
  onMouseLeave() { this.drawing = false; }

  // ── Touch events ──────────────────────────────────────────────

  onTouchStart(e: TouchEvent) {
    e.preventDefault();
    const pt = this.getTouchPoint(e);
    if (this.tool === 'text') { this.placeTextInput(pt.x, pt.y); return; }
    this.drawing = true;
    [this.lastX, this.lastY] = [pt.x, pt.y];
  }

  onTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!this.drawing) return;
    const pt = this.getTouchPoint(e);
    this.drawSegment(pt.x, pt.y);
  }

  onTouchEnd(e: TouchEvent) { e.preventDefault(); this.drawing = false; }

  private getTouchPoint(e: TouchEvent): { x: number; y: number } {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = this.CANVAS_W / rect.width;
    const scaleY = this.CANVAS_H / rect.height;
    const touch = e.touches[0] ?? e.changedTouches[0];
    return {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY,
    };
  }

  // ── Drawing helpers ───────────────────────────────────────────

  private drawSegment(x: number, y: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(this.lastX, this.lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = this.tool === 'eraser' ? '#ffffff' : this.selectedColor;
    ctx.lineWidth = this.tool === 'eraser' ? this.selectedSize * 3 : this.selectedSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    [this.lastX, this.lastY] = [x, y];
  }

  // ── Text tool ─────────────────────────────────────────────────

  private placeTextInput(x: number, y: number) {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / this.CANVAS_W;
    const scaleY = rect.height / this.CANVAS_H;

    this.textX = x;
    this.textY = y;
    this.textValue = '';
    this.showTextInput = true;

    // Position the input overlay in display coords
    const inputEl = document.getElementById('canvas-text-input') as HTMLInputElement | null;
    if (inputEl) {
      const offsetLeft = rect.left + window.scrollX;
      const offsetTop  = rect.top  + window.scrollY;
      inputEl.style.left = `${offsetLeft + x * scaleX}px`;
      inputEl.style.top  = `${offsetTop  + y * scaleY}px`;
      setTimeout(() => inputEl.focus(), 0);
    }
  }

  commitText() {
    if (!this.textValue.trim()) { this.showTextInput = false; return; }
    const ctx = this.ctx;
    ctx.font = `${this.selectedSize * 4 + 8}px system-ui, sans-serif`;
    ctx.fillStyle = this.selectedColor;
    ctx.fillText(this.textValue, this.textX, this.textY);
    this.showTextInput = false;
    this.textValue = '';
  }

  onTextKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); this.commitText(); }
    if (e.key === 'Escape') { this.showTextInput = false; }
  }

  // ── Toolbar actions ───────────────────────────────────────────

  clear() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.CANVAS_W, this.CANVAS_H);
  }

  export() {
    const canvas = this.canvasRef.nativeElement;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'drawing.png', { type: 'image/png' });
      this.exported.emit(file);
    }, 'image/png');
  }
}

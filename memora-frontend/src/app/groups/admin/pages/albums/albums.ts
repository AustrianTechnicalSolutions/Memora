import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AlbumDto, GroupAdminService } from '../../services/admin';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../../translation/translate.pipe';

@Component({
  selector: 'app-group-admin-albums',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe
  ],
  templateUrl: './albums.html',
  styleUrls: ['./albums.css']
})
export class AlbumsComponent implements OnInit, OnDestroy {

  groupId!: string;

  loading = true;
  error?: string;

  albums: AlbumDto[] = [];
  pendingDeleteAlbum: AlbumDto | null = null;
  deletingAlbum = false;

  form;

  constructor(
    private route: ActivatedRoute,
    private service: GroupAdminService,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      dateStart: ['', Validators.required],
      dateEnd: [''],
    });
  }

  private sub = new Subscription();

  ngOnInit(): void {
    this.groupId = this.route.parent?.snapshot.paramMap.get('id')!;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = undefined;

    this.sub.add(
      this.service.getAlbums(this.groupId).subscribe({
        next: (res) => {
          this.albums = res;
          this.loading = false;
        },
        error: (err) => {
          console.error(err);
          this.error = 'Konnte Alben nicht laden.';
          this.loading = false;
        }
      })
    );
  }

  create(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.value;

    this.sub.add(
      this.service.createAlbum(this.groupId, {
        title: String(v.title || '').trim(),
        description: (v.description || '').trim() || null,
        dateStart: String(v.dateStart),
        dateEnd: v.dateEnd ? String(v.dateEnd) : null,
      }).subscribe({
        next: () => {
          this.form.reset();
          this.load();
        },
        error: (err) => {
          console.error(err);
          this.error = 'Album konnte nicht erstellt werden.';
        }
      })
    );
  }

  canDeleteAlbum(album: AlbumDto): boolean {
    return album.id !== 'all' && album.title.trim().toLowerCase() !== 'all memories';
  }

  openDeleteAlbumModal(album: AlbumDto): void {
    if (!this.canDeleteAlbum(album)) return;
    this.pendingDeleteAlbum = album;
  }

  closeDeleteAlbumModal(): void {
    if (this.deletingAlbum) return;
    this.pendingDeleteAlbum = null;
  }

  confirmDeleteAlbum(): void {
    if (!this.pendingDeleteAlbum || this.deletingAlbum) return;

    const album = this.pendingDeleteAlbum;
    this.deletingAlbum = true;

    this.sub.add(
      this.service.deleteAlbum(this.groupId, album.id).subscribe({
        next: () => {
          this.deletingAlbum = false;
          this.pendingDeleteAlbum = null;
          this.load();
        },
        error: (err) => {
          console.error(err);
          this.deletingAlbum = false;
          this.error = 'Album konnte nicht gelöscht werden.';
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}

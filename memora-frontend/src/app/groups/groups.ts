import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environment';

  export interface GroupListItemDto {
    id: string;
    name: string;
    memberCount: number;
  }

export interface GroupDetailDto {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  createdByUserName: string;
}

export interface MemoryDto {
  id: string;
  groupId: string;
  type: number; // 0 Photo, 1 Video, 2 Quote
  title?: string;
  quoteText?: string;
  quoteBy: string | null;
  mediaUrl?: string;
  thumbUrl?: string;
  happenedAt: string;
  createdAt: string;
  createdByUserId: string;
  tags: string[];
  people: string[];
  likeCount?: number;
  commentCount?: number;
  isLiked?: boolean;

  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  locationCity?: string | null;
  locationCountry?: string | null;
}

  export interface CommentDto {
    id: string;
    memoryId: string;
    userId: string;
    userName: string;
    avatarUrl?: string | null;
    content: string;
    createdAt: string;
    parentCommentId?: string | null;
    likeCount: number;
    isLiked: boolean;
  }

  export interface MemoryQuery {
    type?: number;
    from?: string;
    to?: string;
    search?: string;
    sort?: 'newest' | 'oldest';
    page?: number;
    pageSize?: number;
    albumId?: string;
  }

  export interface CreateGroupRequest {
    name: string;
  }

  export interface AlbumDto {
    id: string;
    groupId: string;
    title: string;
    description: string | null;
    dateStart: string;
    dateEnd: string | null;
    memoryCount: number;

    coverUrl?: string;
    topMemory?: {
      id: string;
      type: number,
      mediaUrl?: string;
      thumbUrl?: string;
      quoteText?: string;
      likeCount: number;
    };
    previewMemories?: {
      id: string;
      type: number;
      mediaUrl?: string | null;
      quoteText?: string;
      happenedAt: string;
    }[];
  }

  export interface GroupStatsDto {
    memoryCount: number;
    albumCount: number;
    timeActive: string;
  }

  export interface GroupWeeklyActivityDto {
    photos: number;
    videos: number;
    quotes: number;
    albums: number;
    contributors: {
      userId: string;
      name: string;
      avatarUrl?: string | null;
    }[];
  }

  export interface GroupMemberActivityDto {
    userId: string;
    name: string;
    avatarUrl?: string | null;
  }[];

export interface GroupMemberActivityDto {
  userId: string;
  name: string;
  role: string;
  joinedAt: string;
  lastActiveAt: string | null;
  profileImageUrl?: string | null;
  totalMemories: number;
  photoCount: number;
  videoCount: number;
  quoteCount: number;
}

export interface AlbumPersonDto {
  userId: string;
  avatarUrl: string;
  name: string;
  role: string;
}

@Injectable({
  providedIn: 'root'
})
export class GroupsService {
  private baseUrl = `${environment.apiUrl}/api/groups`;
  private groupsChangedSource = new Subject<void>();
  groupsChanged$ = this.groupsChangedSource.asObservable();

  constructor(private http: HttpClient) {}

  myGroups(): Observable<GroupListItemDto[]> {
    return this.http.get<GroupListItemDto[]>(this.baseUrl);
  }

  groupDetail(groupId: string): Observable<GroupDetailDto> {
    return this.http.get<GroupDetailDto>(`${this.baseUrl}/${groupId}`);
  }

  memories(groupId: string, query: MemoryQuery) {
    let params = new HttpParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params = params.set(k, String(v));
      }
    });

    return this.http.get<{ total: number; items: MemoryDto[] }>(
      `${this.baseUrl}/${groupId}/memories`,
      { params }
    );
  }

  likeMemory(groupId: string, memoryId: string) {
    return this.http.post(`${this.baseUrl}/${groupId}/memories/${memoryId}/likes`, null);
  }

  unlikeMemory(groupId: string, memoryId: string) {
    return this.http.delete(`${this.baseUrl}/${groupId}/memories/${memoryId}/likes`);
  }

  memoryComments(groupId: string, memoryId: string) {
    return this.http.get<CommentDto[]>(
      `${this.baseUrl}/${groupId}/memories/${memoryId}/comments`
    );
  }

  addComment(groupId: string, memoryId: string, body: { content: string; parentCommentId?: string | null }) {
    return this.http.post<CommentDto>(
      `${this.baseUrl}/${groupId}/memories/${memoryId}/comments`,
      body
    );
  }

  likeComment(groupId: string, commentId: string) {
    return this.http.post(`${this.baseUrl}/${groupId}/comments/${commentId}/likes`, null);
  }

  unlikeComment(groupId: string, commentId: string) {
    return this.http.delete(`${this.baseUrl}/${groupId}/comments/${commentId}/likes`);
  }

  createMemory(groupId: string, body: any) {
    return this.http.post(`${this.baseUrl}/${groupId}/memories`, body);
  }

  createMemoryWithFile(groupId: string, file: File, data: any) {
    const formData = new FormData();

    formData.append("type", String(data.type));
    formData.append("title", data.title ?? "");
    formData.append("quoteText", data.quoteText ?? "");
    formData.append("happenedAt", data.happenedAt);
    formData.append("locationName", data.location);
    
    if (data.latitude !== null && data.latitude !== undefined) {
      formData.append("latitude", String(data.latitude));
    }

    if (data.longitude !== null && data.longitude !== undefined) {
      formData.append("longitude", String(data.longitude));
    }

    for (const tag of (data.tags ?? [])) formData.append("tags", tag);
    for (const person of (data.people ?? [])) formData.append("people", person);

    formData.append("file", file);

    if (data.albumId) formData.append('albumId', data.albumId);

    return this.http.post(`${this.baseUrl}/${groupId}/memories/upload`, formData);
  }

  createGroup(name: string) {
    return this.http.post<GroupDetailDto>(this.baseUrl, { name }).pipe(
      tap(() => this.groupsChangedSource.next())
    );
  }

  joinGroup(inviteCode: string) {
    return this.http.post(`${this.baseUrl}/join`, { inviteCode }).pipe(
      tap(() => this.groupsChangedSource.next())
    );
  }

  groupMembers(groupId: string) {
    return this.http.get<{ userId: string; name: string, role: string; avatarUrl: string; }[]>(
      `${this.baseUrl}/${groupId}/members`
    );
  }

  // Albums
  groupAlbums(groupId: string) {
    return this.http.get<AlbumDto[]>(`${this.baseUrl}/${groupId}/albums`);
  }

  createAlbum(groupId: string, body: any) {
    return this.http.post<AlbumDto>(`${this.baseUrl}/${groupId}/albums`, body);
  }

  // Groups page data
  groupStats(groupId: string) {
    return this.http.get<GroupStatsDto>(`${this.baseUrl}/${groupId}/stats`);
  }

  weeklyActivity(groupId: string) {
    return this.http.get<GroupWeeklyActivityDto>(`${this.baseUrl}/${groupId}/activity/week`);
  }

  memberActivity(groupId: string) {
    return this.http.get<GroupMemberActivityDto[]>(`${this.baseUrl}/${groupId}/activity/members`);
  }

  // People in album
  albumPeople(groupId: string, albumId: string) {
    return this.http.get<AlbumPersonDto[]>(`${this.baseUrl}/${groupId}/albums/${albumId}/people`);
  }

  addAlbumPerson(groupId: string, albumId: string, userId: string) {
    return this.http.post(
      `${this.baseUrl}/${groupId}/albums/${albumId}/people/${userId}`,
      null
    );
  }

  removeAlbumPerson(groupId: string, albumId: string, userId: string) {
    return this.http.delete(
      `${this.baseUrl}/${groupId}/albums/${albumId}/people/${userId}`
    );
  }

  notifyGroupsChanged() {
    this.groupsChangedSource.next();
  }

  loadTopMemory(groupId: string, album: AlbumDto) {
    this.http
      .get<any>(`${this.baseUrl}/${groupId}/albums/${album.id}/top-memory`)
      .subscribe({
        next: (m) => {
          album.topMemory = m;
        }
      });
  }

  getAlbumPreviewMemories(groupId: string, albumId: string) {
    return this.http.get<MemoryDto[]>(
      `${this.baseUrl}/${groupId}/albums/${albumId}/preview-memories`
    );
  }

  deleteMemory(groupId: string, memoryId: string) {
    return this.http.delete<void>(
      `${this.baseUrl}/${groupId}/memories/${memoryId}`
    );
  }

  // ── Duel ──────────────────────────────────────────────────────────────────

  duelHeartbeat(groupId: string) {
    return this.http.post<void>(`${this.baseUrl}/${groupId}/duel/heartbeat`, null);
  }

  duelOnline(groupId: string) {
    return this.http.get<{ userId: string; name: string }[]>(
      `${this.baseUrl}/${groupId}/duel/online`
    );
  }

  duelChallenge(groupId: string, targetUserId: string, memoryIds: string[]) {
    return this.http.post<{ duelId: string }>(
      `${this.baseUrl}/${groupId}/duel/challenge`,
      { targetUserId, memoryIds }
    );
  }

  duelPending(groupId: string) {
    return this.http.get<{ duelId: string; challengerName: string; memoryCount: number } | null>(
      `${this.baseUrl}/${groupId}/duel/pending`
    );
  }

  duelAccept(groupId: string, duelId: string) {
    return this.http.post<{ memoryIds: string[] }>(
      `${this.baseUrl}/${groupId}/duel/${duelId}/accept`, null
    );
  }

  duelDecline(groupId: string, duelId: string) {
    return this.http.post<void>(
      `${this.baseUrl}/${groupId}/duel/${duelId}/decline`, null
    );
  }

  duelAnswer(groupId: string, duelId: string, correct: boolean) {
    return this.http.post<DuelStateDto>(
      `${this.baseUrl}/${groupId}/duel/${duelId}/answer`, { correct }
    );
  }

  duelQuit(groupId: string, duelId: string) {
    return this.http.post<void>(
      `${this.baseUrl}/${groupId}/duel/${duelId}/quit`, null
    );
  }

  duelState(groupId: string, duelId: string) {
    return this.http.get<DuelStateDto>(
      `${this.baseUrl}/${groupId}/duel/${duelId}/state`
    );
  }
}

export interface DuelStateDto {
  duelId: string;
  status: 'active' | 'finished' | 'declined' | 'pending';
  myScore: number;
  opponentScore: number;
  myAnswered: number;
  opponentAnswered: number;
  total: number;
  memoryIds: string[];
  opponentForfeited?: boolean;
}

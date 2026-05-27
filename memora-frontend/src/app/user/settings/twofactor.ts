import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { environment } from "../../../environment";

export interface TwoFactorSetupResponse {
    secret: string;
    otpauthUrl: string;
}

export interface TwoFactorEnableResponse {
    backupCodes: string[];
}

@Injectable({ providedIn: 'root' })
export class TwoFactorService {
    private api = `${environment.apiUrl}/api/2fa`;

    constructor(private http: HttpClient) {}

    setup() {
        return this.http.post<TwoFactorSetupResponse>(`${this.api}/setup`, {});
    }

    enable(code: string) {
        return this.http.post<TwoFactorEnableResponse>(`${this.api}/enable`, { code });
    }

    disable(code: string) {
        return this.http.post(`${this.api}/disable`, { code });
    }

    regenerateBackupCodes(code: string) {
        return this.http.post<{ backupCodes: string[] }>(`${this.api}/backup-codes`, { code });
    }
}
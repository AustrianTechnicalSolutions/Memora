using System.Security.Cryptography;
using System.Text.Json;
using AuthApi.Data;
using AuthApi.Extensions;
using AuthApi.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OtpNet;

namespace AuthApi.Endpoints;

public class Disable2FARequest
{
    public string Code { get; set; } = "";
}

public class BackupCodesRequest
{
    public string Code { get; set; } = "";
}

[ApiController]
[Route("api/2fa")]
[Authorize]
public class TwoFactorController : BaseApiController
{
    private readonly AppDbContext _db;

    public TwoFactorController(AppDbContext db)
    {
        _db = db;
    }

    [HttpPost("setup")]
    public async Task<IActionResult> Setup()
    {
        var uid = User.UserId();
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == uid);
        if (user is null) throw new ApiException("not_found", "User not found.", 404);

        // Generate new secret every time setup is called
        var secretBytes = KeyGeneration.GenerateRandomKey(20);
        var secretBase32 = Base32Encoding.ToString(secretBytes);

        user.TwoFactorSecret = secretBase32;
        user.TwoFactorEnabled = false;
        await _db.SaveChangesAsync();

        var issuer = "Memora";
        var label = $"{issuer}:{user.Email}";
        var otpauth = $"otpauth://totp/{Uri.EscapeDataString(label)}?secret={secretBase32}&issuer={Uri.EscapeDataString(issuer)}&digits=6";

        return Ok(new
        {
            secret = secretBase32,
            otpauthUrl = otpauth
        });
    }

    public class Enable2FARequest
    {
        public string Code { get; set; } = "";
    }

    [HttpPost("enable")]
    public async Task<IActionResult> Enable([FromBody] Enable2FARequest req)
    {
        var uid = User.UserId();
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == uid);
        if (user is null) throw new ApiException("not_found", "User not found.", 404);

        if (string.IsNullOrWhiteSpace(user.TwoFactorSecret))
            throw new ApiException("invalid_code", "2FA secret not set.");

        if (!VerifyTotp(user, req.Code))
            throw new ApiException("invalid_code", "Invalid 2FA code.");

        var backupCodes = GenerateBackupCodes();

        user.TwoFactorEnabled = true;
        user.TwoFactorBackupCodesJson = JsonSerializer.Serialize(backupCodes);

        await _db.SaveChangesAsync();

        return Ok(new { enabled = true, backupCodes });
    }

    [HttpPost("disable")]
    public async Task<IActionResult> Disable([FromBody] Disable2FARequest req)
    {
        var uid = User.UserId();
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == uid);
        if (user is null) throw new ApiException("not_found", "User not found.", 404);

        if (!user.TwoFactorEnabled)
            return Ok(new { enabled = false });

        var validTotp = VerifyTotp(user, req.Code);
        var validBackupCode = await VerifyBackupCode(user, req.Code);

        if (!validTotp && !validBackupCode)
            throw new ApiException("invalid_code", "Invalid 2FA code.");

        user.TwoFactorEnabled = false;
        user.TwoFactorSecret = null;
        user.TwoFactorBackupCodesJson = null;

        await _db.SaveChangesAsync();

        return Ok(new { enabled = false });
    }

    [HttpPost("backup-codes")]
    public async Task<IActionResult> RegenerateBackupCodes([FromBody] BackupCodesRequest req)
    {
        var uid = User.UserId();
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == uid);
        if (user is null) throw new ApiException("not_found", "User not found.", 404);

        if (!user.TwoFactorEnabled)
            throw new ApiException("two_factor_disabled", "2FA is not enabled.");

        if (!VerifyTotp(user, req.Code))
            throw new ApiException("invalid_code", "Invalid 2FA code.");

        var backupCodes = GenerateBackupCodes();

        user.TwoFactorBackupCodesJson = JsonSerializer.Serialize(backupCodes);
        await _db.SaveChangesAsync();

        return Ok(new { backupCodes });
    }

    private static List<string> GenerateBackupCodes(int count = 8)
    {
        var codes = new List<string>();

        for (var i = 0; i < count; i++)
        {
            // 8 bytes = 16 hex chars
            var bytes = RandomNumberGenerator.GetBytes(8);

            var hex = Convert.ToHexString(bytes);

            // XXXX-XXXX-XXXX-XXXX
            var code =
                $"{hex[..4]}-{hex[4..8]}-{hex[8..12]}-{hex[12..16]}";

            codes.Add(code);
        }

        return codes;
    }

    private static bool VerifyTotp(AppUser user, string code)
    {
        if (string.IsNullOrWhiteSpace(user.TwoFactorSecret))
            return false;

        var totp = new Totp(Base32Encoding.ToBytes(user.TwoFactorSecret));

        return totp.VerifyTotp(
            code.Trim(),
            out _,
            new VerificationWindow(1, 1)
        );
    }

    private async Task<bool> VerifyBackupCode(AppUser user, string code)
    {
        if (string.IsNullOrWhiteSpace(user.TwoFactorBackupCodesJson))
            return false;

        var codes = JsonSerializer.Deserialize<List<string>>(
            user.TwoFactorBackupCodesJson
        ) ?? [];

        var normalized = code.Trim().ToUpperInvariant();

        var match = codes.FirstOrDefault(x =>
            x.Trim().ToUpperInvariant() == normalized
        );

        if (match is null)
            return false;

        // remove used code
        codes.Remove(match);

        user.TwoFactorBackupCodesJson =
            JsonSerializer.Serialize(codes);

        // IMPORTANT: persist immediately
        await _db.SaveChangesAsync();

        return true;
    }
}
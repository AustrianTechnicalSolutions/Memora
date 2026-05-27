using System.Text.Json;
using AuthApi.Data;
using AuthApi.Models;
using AuthApi.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OtpNet;

namespace AuthApi.Endpoints;

[ApiController]
[Route("api/account")]
[Authorize]
public class AccountEndpoint : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IPasswordHasher<AppUser> _hasher;

    public AccountEndpoint(AppDbContext db, IPasswordHasher<AppUser> hasher)
    {
        _db = db;
        _hasher = hasher;
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var uid = User.UserId();

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == uid);
        if (user is null) throw new ApiException("not_found", "User not found.", 404);

        return Ok(new
        {
            user.Id,
            user.Email,
            user.DisplayName,
            user.Bio,
            user.Status,
            user.BirthDate,
            user.ProfileImageUrl,
            user.PhoneNumber,
            user.DiscordTag,
            user.InstagramUrl,
            user.TikTokUrl,
            user.YouTubeUrl,
            user.WebsiteUrl,
            user.TwoFactorEnabled,
        });
    }

    public class UpdateProfileRequest
    {
        public string? DisplayName { get; set; }
        public string? Bio { get; set; }
        public string? Status { get; set; }
        public DateTime? BirthDate { get; set; }
        public string? ProfileImageUrl { get; set; }

        public string? PhoneNumber { get; set; }
        public string? DiscordTag { get; set; }

        public string? InstagramUrl { get; set; }
        public string? TikTokUrl { get; set; }
        public string? YouTubeUrl { get; set; }
        public string? WebsiteUrl { get; set; }
    }

    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest req)
    {
        var uid = User.UserId();

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == uid);
        if (user is null) throw new ApiException("not_found", "User not found.", 404);

        if (req.DisplayName is not null) user.DisplayName = req.DisplayName.Trim();
        user.Bio = req.Bio;
        user.Status = req.Status;
        user.BirthDate = req.BirthDate;
        user.ProfileImageUrl = req.ProfileImageUrl;

        user.PhoneNumber = req.PhoneNumber;
        user.DiscordTag = req.DiscordTag;

        user.InstagramUrl = req.InstagramUrl;
        user.TikTokUrl = req.TikTokUrl;
        user.YouTubeUrl = req.YouTubeUrl;
        user.WebsiteUrl = req.WebsiteUrl;

        await _db.SaveChangesAsync();
        return Ok();
    }

    public class ChangePasswordRequest
    {
        public string CurrentPassword { get; set; } = "";
        public string NewPassword { get; set; } = "";
        public string? TwoFactorCode { get; set; }
    }

    [HttpPut("password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest req)
    {
        var uid = User.UserId();

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == uid);
        if (user is null) throw new ApiException("not_found", "User not found.", 404);

        var verify = _hasher.VerifyHashedPassword(user, user.PasswordHash, req.CurrentPassword);
        if (verify == PasswordVerificationResult.Failed)
            throw new ApiException("invalid_credentials", "Current password is incorrect.", 400);

        if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 8)
            throw new ApiException("invalid_password", "Password must be at least 8 characters.", 400);

        if (req.NewPassword == req.CurrentPassword)
            throw new ApiException("invalid_password", "New password must be different.", 400);

        if (user.TwoFactorEnabled)
        {
            if (string.IsNullOrWhiteSpace(req.TwoFactorCode))
                throw new ApiException("two_factor_required", "Two-factor authentication code required.", 400);

            var validTotp = VerifyTotp(user, req.TwoFactorCode);
            var validBackup = await VerifyBackupCode(user, req.TwoFactorCode);

            if (!validTotp && !validBackup)
                throw new ApiException("invalid_two_factor", "Invalid two-factor code.", 400);
        }

        user.PasswordHash = _hasher.HashPassword(user, req.NewPassword);
        await _db.SaveChangesAsync();

        return Ok();
    }

    private static bool VerifyTotp(AppUser user, string code)
    {
        if (string.IsNullOrWhiteSpace(user.TwoFactorSecret)) return false;
        var totp = new Totp(Base32Encoding.ToBytes(user.TwoFactorSecret));
        return totp.VerifyTotp(code.Trim(), out _, new VerificationWindow(1, 1));
    }

    private async Task<bool> VerifyBackupCode(AppUser user, string code)
    {
        if (string.IsNullOrWhiteSpace(user.TwoFactorBackupCodesJson)) return false;
        var codes = JsonSerializer.Deserialize<List<string>>(user.TwoFactorBackupCodesJson) ?? [];
        var normalized = code.Trim().ToUpperInvariant();
        var match = codes.FirstOrDefault(x => x.Trim().ToUpperInvariant() == normalized);
        if (match is null) return false;
        codes.Remove(match);
        user.TwoFactorBackupCodesJson = JsonSerializer.Serialize(codes);
        await _db.SaveChangesAsync();
        return true;
    }
}

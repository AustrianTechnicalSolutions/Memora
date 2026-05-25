using AuthApi.Data;
using AuthApi.Extensions;
using AuthApi.Models;
using AuthApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

[ApiController]
[Route("api/groups/{groupId:guid}/duel")]
[Authorize]
public class DuelEndpoint : ControllerBase
{
    private readonly DuelService _duel;
    private readonly AppDbContext _db;

    public DuelEndpoint(DuelService duel, AppDbContext db)
    {
        _duel = duel;
        _db = db;
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    [HttpPost("heartbeat")]
    public IActionResult Heartbeat(Guid groupId)
    {
        _duel.Heartbeat(User.UserId());
        return NoContent();
    }

    // ── Online members ────────────────────────────────────────────────────────
    [HttpGet("online")]
    public async Task<IActionResult> Online(Guid groupId)
    {
        var onlineIds = _duel.OnlineUserIds().ToHashSet();

        var members = await _db.Set<GroupMember>()
            .Where(m => m.GroupId == groupId && onlineIds.Contains(m.UserId))
            .Join(_db.Set<AppUser>(), m => m.UserId, u => u.Id,
                  (m, u) => new { userId = m.UserId, name = u.DisplayName })
            .ToListAsync();

        return Ok(members);
    }

    // ── Create challenge ──────────────────────────────────────────────────────
    public class ChallengeRequest
    {
        public Guid TargetUserId { get; set; }
        public string[] MemoryIds { get; set; } = [];
    }

    [HttpPost("challenge")]
    public async Task<IActionResult> Challenge(Guid groupId, [FromBody] ChallengeRequest req)
    {
        var uid = User.UserId();
        var me = await _db.Set<AppUser>().Select(u => new { u.Id, u.DisplayName })
            .FirstOrDefaultAsync(u => u.Id == uid);
        if (me is null) return NotFound();

        if (req.MemoryIds.Length < 2)
            return BadRequest("Need at least 2 memories.");

        var session = _duel.Create(groupId, uid, me.DisplayName, req.TargetUserId, req.MemoryIds);
        return Ok(new { duelId = session.Id });
    }

    // ── Pending challenge for current user ────────────────────────────────────
    [HttpGet("pending")]
    public IActionResult Pending(Guid groupId)
    {
        var uid = User.UserId();
        var s = _duel.PendingFor(uid, groupId);
        if (s is null) return Ok(null);

        return Ok(new
        {
            duelId = s.Id,
            challengerName = s.ChallengerName,
            memoryCount = s.TotalQuestions,
        });
    }

    // ── Active duel ───────────────────────────────────────────────────────────
    [HttpGet("active")]
    public IActionResult Active(Guid groupId)
    {
        var uid = User.UserId();
        var s = _duel.ActiveFor(uid, groupId);
        if (s is null) return Ok(null);
        return Ok(BuildState(s, uid));
    }

    // ── Accept ────────────────────────────────────────────────────────────────
    [HttpPost("{duelId:guid}/accept")]
    public IActionResult Accept(Guid groupId, Guid duelId)
    {
        var uid = User.UserId();
        if (!_duel.Accept(duelId, uid))
            return BadRequest("Cannot accept this challenge.");
        var s = _duel.Get(duelId)!;
        return Ok(new { memoryIds = s.MemoryIds });
    }

    // ── Decline ───────────────────────────────────────────────────────────────
    [HttpPost("{duelId:guid}/decline")]
    public IActionResult Decline(Guid groupId, Guid duelId)
    {
        var uid = User.UserId();
        if (!_duel.Decline(duelId, uid))
            return BadRequest("Cannot decline.");
        return Ok();
    }

    // ── Submit answer ─────────────────────────────────────────────────────────
    public class AnswerRequest { public bool Correct { get; set; } }

    [HttpPost("{duelId:guid}/answer")]
    public IActionResult Answer(Guid groupId, Guid duelId, [FromBody] AnswerRequest req)
    {
        var uid = User.UserId();
        if (!_duel.SubmitAnswer(duelId, uid, req.Correct))
            return BadRequest("Cannot submit answer.");
        var s = _duel.Get(duelId)!;
        return Ok(BuildState(s, uid));
    }

    // ── Quit ──────────────────────────────────────────────────────────────────
    [HttpPost("{duelId:guid}/quit")]
    public IActionResult Quit(Guid groupId, Guid duelId)
    {
        var uid = User.UserId();
        _duel.Quit(duelId, uid);
        return Ok();
    }

    // ── State ─────────────────────────────────────────────────────────────────
    [HttpGet("{duelId:guid}/state")]
    public IActionResult State(Guid groupId, Guid duelId)
    {
        var uid = User.UserId();
        var s = _duel.Get(duelId);
        if (s is null) return NotFound();
        return Ok(BuildState(s, uid));
    }

    private static object BuildState(DuelSession s, Guid uid)
    {
        bool isChallenger = s.ChallengerId == uid;
        return new
        {
            duelId = s.Id,
            status = s.Status,
            myScore = isChallenger ? s.ChallengerScore : s.ChallengedScore,
            opponentScore = isChallenger ? s.ChallengedScore : s.ChallengerScore,
            myAnswered = isChallenger ? s.ChallengerAnswered : s.ChallengedAnswered,
            opponentAnswered = isChallenger ? s.ChallengedAnswered : s.ChallengerAnswered,
            total = s.TotalQuestions,
            memoryIds = s.MemoryIds,
            opponentForfeited = s.QuitBy.HasValue && s.QuitBy != uid,
        };
    }
}

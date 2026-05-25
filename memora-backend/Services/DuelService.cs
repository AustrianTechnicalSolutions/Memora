using System.Collections.Concurrent;

namespace AuthApi.Services;

public class DuelSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid GroupId { get; set; }
    public Guid ChallengerId { get; set; }
    public string ChallengerName { get; set; } = "";
    public Guid ChallengedId { get; set; }
    public string Status { get; set; } = "pending"; // pending | active | declined | finished
    public string[] MemoryIds { get; set; } = [];
    public int ChallengerScore { get; set; }
    public int ChallengedScore { get; set; }
    public int ChallengerAnswered { get; set; }
    public int ChallengedAnswered { get; set; }
    public int TotalQuestions { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? QuitBy { get; set; }
}

public class DuelService
{
    private readonly ConcurrentDictionary<Guid, DuelSession> _sessions = new();
    private readonly ConcurrentDictionary<Guid, DateTime> _heartbeats = new();

    public void Heartbeat(Guid userId) => _heartbeats[userId] = DateTime.UtcNow;

    public IEnumerable<Guid> OnlineUserIds()
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-2);
        return _heartbeats.Where(x => x.Value >= cutoff).Select(x => x.Key);
    }

    public DuelSession Create(Guid groupId, Guid challengerId, string challengerName, Guid challengedId, string[] memoryIds)
    {
        var session = new DuelSession
        {
            GroupId = groupId,
            ChallengerId = challengerId,
            ChallengerName = challengerName,
            ChallengedId = challengedId,
            MemoryIds = memoryIds,
            TotalQuestions = memoryIds.Length,
        };
        _sessions[session.Id] = session;
        Cleanup();
        return session;
    }

    public DuelSession? Get(Guid id) => _sessions.TryGetValue(id, out var s) ? s : null;

    public DuelSession? PendingFor(Guid userId, Guid groupId) =>
        _sessions.Values.FirstOrDefault(s =>
            s.ChallengedId == userId && s.GroupId == groupId && s.Status == "pending");

    public DuelSession? ActiveFor(Guid userId, Guid groupId) =>
        _sessions.Values.FirstOrDefault(s =>
            (s.ChallengerId == userId || s.ChallengedId == userId) &&
            s.GroupId == groupId && s.Status == "active");

    public bool Accept(Guid duelId, Guid userId)
    {
        if (!_sessions.TryGetValue(duelId, out var s)) return false;
        if (s.ChallengedId != userId || s.Status != "pending") return false;
        s.Status = "active";
        return true;
    }

    public bool Decline(Guid duelId, Guid userId)
    {
        if (!_sessions.TryGetValue(duelId, out var s)) return false;
        if (s.ChallengedId != userId || s.Status != "pending") return false;
        s.Status = "declined";
        return true;
    }

    public bool SubmitAnswer(Guid duelId, Guid userId, bool correct)
    {
        if (!_sessions.TryGetValue(duelId, out var s)) return false;
        if (s.Status != "active") return false;

        if (s.ChallengerId == userId)
        {
            if (correct) s.ChallengerScore++;
            s.ChallengerAnswered++;
        }
        else if (s.ChallengedId == userId)
        {
            if (correct) s.ChallengedScore++;
            s.ChallengedAnswered++;
        }
        else return false;

        if (s.ChallengerAnswered >= s.TotalQuestions && s.ChallengedAnswered >= s.TotalQuestions)
            s.Status = "finished";

        return true;
    }

    public bool Quit(Guid duelId, Guid userId)
    {
        if (!_sessions.TryGetValue(duelId, out var s)) return false;
        if (s.Status != "active") return false;
        if (s.ChallengerId != userId && s.ChallengedId != userId) return false;
        s.QuitBy = userId;
        s.Status = "finished";
        return true;
    }

    private void Cleanup()
    {
        var cutoff = DateTime.UtcNow.AddHours(-1);
        foreach (var key in _sessions.Where(x => x.Value.CreatedAt < cutoff).Select(x => x.Key).ToList())
            _sessions.TryRemove(key, out _);
    }
}

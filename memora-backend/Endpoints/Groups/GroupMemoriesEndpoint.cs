using AuthApi.Data;
using AuthApi.Extensions;
using AuthApi.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

[ApiController]
[Route("api/groups/{groupId:guid}/memories")]
[Authorize]
public class GroupMemoriesController : BaseApiController
{
    private readonly AppDbContext _db;
    private readonly IWebHostEnvironment _environment;
    private readonly ICityLookupService _cityLookup;
    private readonly ICountryLookupService _countryLookup;

    public GroupMemoriesController(AppDbContext db, IWebHostEnvironment environment, ICityLookupService cityLookup, ICountryLookupService countryLookup)
    {
        _db = db;
        _environment = environment;
        _cityLookup = cityLookup;
        _countryLookup = countryLookup;
    }

    [HttpGet()]
        public async Task<ActionResult<object>> Memories(Guid groupId, [FromQuery] MemoryQuery q)
    {
        var uid = User.UserId();
        await EnsureGroupMember(_db, groupId, uid);

        var page = q.Page < 1 ? 1 : q.Page;
        var pageSize = q.PageSize < 1 ? 20 : Math.Min(q.PageSize, 200);

        var query = _db.Set<Memory>()
            .AsNoTracking()
            .Include(x => x.Tags)
            .Include(x => x.People)
            .Where(x => x.GroupId == groupId);

        if (q.AlbumId.HasValue) query = query.Where(x => x.AlbumId == q.AlbumId.Value);
        if (q.Type.HasValue) query = query.Where(x => x.Type == q.Type.Value);
        if (q.From.HasValue) query = query.Where(x => x.HappenedAt >= q.From.Value);
        if (q.To.HasValue) query = query.Where(x => x.HappenedAt <= q.To.Value);

        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var s = q.Search.Trim().ToLower();
            query = query.Where(x =>
                (x.Title ?? "").ToLower().Contains(s) ||
                (x.QuoteText ?? "").ToLower().Contains(s) ||
                x.Tags.Any(t => t.Value.ToLower().Contains(s))
            );
        }

        query = q.Sort == "oldest"
            ? query.OrderBy(x => x.HappenedAt).ThenBy(x => x.CreatedAt)
            : query.OrderByDescending(x => x.HappenedAt).ThenByDescending(x => x.CreatedAt);

        var total = await query.CountAsync();
        var pageItems = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var memoryIds = pageItems.Select(x => x.Id).ToList();

        var likeCounts = await _db.Set<MemoryLike>()
            .AsNoTracking()
            .Where(l => memoryIds.Contains(l.MemoryId))
            .GroupBy(l => l.MemoryId)
            .Select(g => new { MemoryId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.MemoryId, x => x.Count);

        var commentCounts = await _db.Set<MemoryComment>()
            .AsNoTracking()
            .Where(c => memoryIds.Contains(c.MemoryId))
            .GroupBy(c => c.MemoryId)
            .Select(g => new { MemoryId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.MemoryId, x => x.Count);

        var likedIds = await _db.Set<MemoryLike>()
            .AsNoTracking()
            .Where(l => memoryIds.Contains(l.MemoryId) && l.UserId == uid)
            .Select(l => l.MemoryId)
            .ToListAsync();
        var likedSet = likedIds.ToHashSet();

        var items = pageItems.Select(x =>
        {
            var tags = x.Tags?
                .Select(t => t.Value)
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .ToList();

            var people = x.People?
                .Select(t => t.Name)
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .ToList();

            var protectedMediaUrl = !string.IsNullOrWhiteSpace(x.MediaUrl)
                ? $"/api/groups/{groupId}/memories/{x.Id}/media"
                : null;

            return new MemoryDto(
                x.Id, x.GroupId, x.Type, x.Title, x.QuoteText, x.QuoteBy, protectedMediaUrl, x.ThumbUrl,
                x.HappenedAt, x.CreatedAt, x.CreatedByUserId,
                tags != null && tags.Count > 0 ? tags : null,
                people != null && people.Count > 0 ? people : null,
                x.AlbumId,
                likeCounts.TryGetValue(x.Id, out var likeCount) ? likeCount : 0,
                commentCounts.TryGetValue(x.Id, out var commentCount) ? commentCount : 0,
                likedSet.Contains(x.Id),

                x.LocationName,
                x.Latitude,
                x.Longitude,

                x.LocationCity,
                x.LocationCountry
            );
        }).ToList();

        return Ok(new { total, items });
    }

    [HttpPost()]
    public async Task<ActionResult<MemoryDto>> CreateQuote(Guid groupId, [FromBody] CreateQuoteRequest req)
    {
        var uid = User.UserId();
        await EnsureGroupMember(_db, groupId, uid);

        var m = new Memory
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            Type = MemoryType.Quote,
            Title = req.Title,
            QuoteText = req.QuoteText,
            QuoteBy = req.QuoteBy,
            HappenedAt = req.HappenedAt,
            CreatedByUserId = uid,
            AlbumId = req.AlbumId,
        };

        if (req.Tags?.Any() == true)
        {
            var cleanTags = req.Tags
                .Select(t => t.Trim())
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Distinct()
                .ToList();

            m.Tags = cleanTags.Select(t => new MemoryTag { MemoryId = m.Id, Value = t }).ToList();
        }

        _db.Add(m);
        await _db.SaveChangesAsync();

        var tags = m.Tags.Select(t => t.Value).ToList();
        var people = m.People.Select(t => t.Name).ToList();

        return Ok(new MemoryDto(
            m.Id, m.GroupId, m.Type, m.Title, m.QuoteText, m.QuoteBy, m.MediaUrl, m.ThumbUrl,
            m.HappenedAt, m.CreatedAt, m.CreatedByUserId,
            tags.Count == 0 ? null : tags,
            people.Count == 0 ? null : people,
            m.AlbumId,
            0,
            0,
            false,

            m.LocationName,
            m.Latitude,
            m.Longitude,

            null,
            null
        ));
    }

    [HttpDelete("{memoryId:guid}")]
    public async Task<IActionResult> DeleteMemory(Guid groupId, Guid memoryId)
    {
        var uid = User.UserId();

        await EnsureGroupMember(_db, groupId, uid);

        var memory = await _db.Set<Memory>()
            .Include(x => x.Tags)
            .Include(x => x.People)
            .FirstOrDefaultAsync(x => x.Id == memoryId && x.GroupId == groupId);

        if (memory == null)
            throw new ApiException("not_found", "Memory not found.", 404);

        var isCreator = memory.CreatedByUserId == uid;

        var isAdmin = await _db.Set<GroupMember>()
            .AnyAsync(x =>
                x.GroupId == groupId &&
                x.UserId == uid &&
                x.Role == GroupRole.Admin);

        if (!isCreator && !isAdmin)
            throw new ApiException("forbidden", "You are not allowed to delete this memory.", 403);

        if (!string.IsNullOrWhiteSpace(memory.MediaUrl))
        {
            var webRootPath = _environment.WebRootPath
                ?? Path.Combine(_environment.ContentRootPath, "wwwroot");

            var uploadsFolder = Path.Combine(webRootPath, "uploads");
            var fileName = Path.GetFileName(memory.MediaUrl);
            var filePath = Path.Combine(uploadsFolder, fileName);

            if (System.IO.File.Exists(filePath))
            {
                System.IO.File.Delete(filePath);
            }
        }

        _db.Remove(memory);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    [HttpPost("upload")]
    [RequestSizeLimit(200_000_000)] // 200MB limit
    public async Task<ActionResult<MemoryDto>> CreateMemory(Guid groupId, [FromForm] CreateMemoryRequest req)
    {
        if (req == null)
            throw new ApiException("invalid_request", "Request body is required.");

        var uid = User.UserId();
        await EnsureGroupMember(_db, groupId, uid);

        string? mediaUrl = req.MediaUrl;

        if (req?.File?.Length > 200_000_000)
            throw new ApiException("file_too_large", "File too large.");

        if (req?.File != null && req.File.Length > 0)
        {
            var webRootPath = _environment.WebRootPath ?? Path.Combine(_environment.ContentRootPath, "wwwroot");
            var uploadsFolder = Path.Combine(webRootPath, "uploads");
            Directory.CreateDirectory(uploadsFolder);

            var ext = Path.GetExtension(req.File.FileName);

            var allowed = new[] { ".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mp3", ".mov", ".webm", ".svg", ".ogg" };
            if (!allowed.Contains(ext.ToLower()))
                throw new ApiException("invalid_file", "File type not allowed.");

            var fileName = $"{Guid.NewGuid()}{ext}";
            var filePath = Path.Combine(uploadsFolder, fileName);

            using var stream = System.IO.File.Create(filePath);
            await req.File.CopyToAsync(stream);

            mediaUrl = $"/uploads/{fileName}";
        }

        string? locationCity = null;
        string? locationCountry = null;

        if (req.Latitude.HasValue && req.Longitude.HasValue)
        {
            var result = _cityLookup.FindNearest(
                req.Latitude.Value,
                req.Longitude.Value
            );

            if (result != null)
            {
                locationCity = result.City;
                locationCountry = _countryLookup.GetCountryName(result.CountryCode);
            }
        }

        var m = new Memory
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            Type = req!.Type,
            Title = req.Title,
            QuoteText = req.QuoteText,
            MediaUrl = mediaUrl,
            ThumbUrl = req.ThumbUrl,
            HappenedAt = req.HappenedAt,
            CreatedByUserId = uid,
            AlbumId = req.AlbumId,
            //Tags = req.Tags,

            LocationName = req.LocationName,
            Latitude = req.Latitude,
            Longitude = req.Longitude,
            LocationCity = locationCity,
            LocationCountry = locationCountry
        };

        if (req.Tags?.Any() == true)
        {
            var cleanTags = req.Tags
                .Select(t => t.Trim())
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Distinct()
                .ToList();

            m.Tags = cleanTags
                .Select(t => new MemoryTag { MemoryId = m.Id, Value = t })
                .ToList();
        }

        if (req.People?.Any() == true)
        {
            m.People = req.People
                .Select(p => p.Trim())
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Distinct()
                .Select(p => new MemoryPerson
                {
                    MemoryId = m.Id,
                    Name = p
                })
                .ToList();
        }

        _db.Add(m);
        await _db.SaveChangesAsync();

        return Ok(new MemoryDto(
            m.Id, m.GroupId, m.Type, m.Title, m.QuoteText, m.QuoteBy, m.MediaUrl, m.ThumbUrl,
            m.HappenedAt, m.CreatedAt, m.CreatedByUserId,
            m.Tags.Select(t => t.Value).ToList(),
            m.People.Select(t => t.Name).ToList(),
            m.AlbumId,
            0,
            0,
            false,

            m.LocationName,
            m.Latitude,
            m.Longitude,

            m.LocationCity,
            m.LocationCountry
        ));
    }

    [HttpGet("{memoryId:guid}/media")]
    public async Task<IActionResult> GetMemoryMedia(Guid groupId, Guid memoryId)
    {
        var uid = User.UserId();

        await EnsureGroupMember(_db, groupId, uid);

        var memory = await _db.Set<Memory>()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == memoryId && x.GroupId == groupId);

        if (memory == null || string.IsNullOrWhiteSpace(memory.MediaUrl))
            throw new ApiException("not_found", "Memory not found.", 404);

        var webRootPath = _environment.WebRootPath ?? Path.Combine(_environment.ContentRootPath, "wwwroot");
        var uploadsFolder = Path.Combine(webRootPath, "uploads");

        var fileName = Path.GetFileName(memory.MediaUrl);
        var filePath = Path.Combine(uploadsFolder, fileName);

        if (!System.IO.File.Exists(filePath))
            throw new ApiException("not_found", "Resource not found.", 404);

        var contentType = GetContentType(filePath);

        return PhysicalFile(filePath, contentType);
    }

    private static string GetContentType(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();

        return ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".mp4" => "video/mp4",
            ".mov" => "video/quicktime",
            ".webm" => "video/webm",
            _ => "application/octet-stream"
        };
    }
}
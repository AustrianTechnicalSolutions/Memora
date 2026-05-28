using AuthApi.Data;
using AuthApi.Models;
using AuthApi.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using AuthApi.Dtos;

namespace AuthApi.Endpoints;

[ApiController]
[Route("api/groups/{groupId:guid}/albums")]
[Authorize]
public class AlbumEndpoint : BaseApiController
{
    private readonly AppDbContext _db;
    private readonly IPasswordHasher<AppUser> _hasher;

    public AlbumEndpoint(AppDbContext db, IPasswordHasher<AppUser> hasher)
    {
        _db = db;
        _hasher = hasher;
    }

    [HttpGet]
    public async Task<ActionResult<List<AlbumDto>>> Albums(Guid groupId)
    {
        var uid = User.UserId();
        var isMember = await _db.Set<GroupMember>().AnyAsync(x => x.GroupId == groupId && x.UserId == uid);
        if (!isMember) return Forbid();

        var albums = await _db.Set<Album>()
            .AsNoTracking()
            .Where(a => a.GroupId == groupId)
            .OrderByDescending(a => a.DateStart)
            .Select(a => new AlbumDto(
                a.Id,
                a.GroupId,
                a.Title,
                a.Description,
                a.DateStart,
                a.DateEnd,
                a.Memories.Count
            ))
            .ToListAsync();

        return Ok(albums);
    }

    [HttpPost]
    public async Task<ActionResult<AlbumDto>> CreateAlbum(Guid groupId, [FromBody] CreateAlbumRequest req)
    {
        var uid = User.UserId();
        var isMember = await _db.Set<GroupMember>().AnyAsync(x => x.GroupId == groupId && x.UserId == uid);
        if (!isMember) return Forbid();

        var album = new Album
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            Title = req.Title.Trim(),
            Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
            DateStart = req.DateStart,
            DateEnd = req.DateEnd,
            CreatedByUserId = uid,
        };

        _db.Add(album);
        await _db.SaveChangesAsync();

        return Ok(new AlbumDto(
            album.Id,
            album.GroupId,
            album.Title,
            album.Description,
            album.DateStart,
            album.DateEnd,
            0
        ));
    }

    [HttpDelete("{albumId:guid}")]
    public async Task<IActionResult> DeleteAlbum(Guid groupId, Guid albumId)
    {
        var uid = User.UserId();

        var album = await _db.Set<Album>()
            .FirstOrDefaultAsync(a => a.Id == albumId && a.GroupId == groupId);

        if (album == null) return NotFound();
        if (!await CanEditAlbum(albumId, uid)) return Forbid();

        var memories = await _db.Set<Memory>()
            .Where(m => m.GroupId == groupId && m.AlbumId == albumId)
            .ToListAsync();

        foreach (var memory in memories)
        {
            memory.AlbumId = null;
        }

        var albumPeople = await _db.Set<AlbumPerson>()
            .Where(p => p.AlbumId == albumId)
            .ToListAsync();

        if (albumPeople.Count > 0)
        {
            _db.RemoveRange(albumPeople);
        }

        _db.Remove(album);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    [HttpGet("{albumId:guid}/people")]
    public async Task<ActionResult<List<GroupMemberDto>>> AlbumPeople(Guid groupId, Guid albumId)
    {
        var uid = User.UserId();

        var album = await _db.Set<Album>()
            .Include(a => a.People)
            .ThenInclude(p => p.User)
            .FirstOrDefaultAsync(a => a.Id == albumId && a.GroupId == groupId);

        if (album == null) return NotFound();

        return Ok(album.People.Select(p =>
            new GroupMemberDto(
                p.UserId,
                p.User.DisplayName,
                "Album",
                p.User.ProfileImageUrl
            )
        ));
    }

    [HttpPost("{albumId:guid}/people/{userId}")]
    public async Task<IActionResult> AddPerson(Guid groupId, Guid albumId, Guid userId)
    {
        var uid = User.UserId();
        if (!await CanEditAlbum(albumId, uid)) return Forbid();

        var exists = await _db.Set<AlbumPerson>()
            .AnyAsync(x => x.AlbumId == albumId && x.UserId == userId);

        if (!exists)
        {
            _db.Add(new AlbumPerson
            {
                AlbumId = albumId,
                UserId = userId
            });

            await _db.SaveChangesAsync();
        }

        return NoContent();
    }

    [HttpDelete("{albumId:guid}/people/{userId}")]
    public async Task<IActionResult> RemovePerson(Guid groupId, Guid albumId, Guid userId)
    {
        var uid = User.UserId();
        if (!await CanEditAlbum(albumId, uid)) return Forbid();

        var entry = await _db.Set<AlbumPerson>()
            .FirstOrDefaultAsync(x => x.AlbumId == albumId && x.UserId == userId);

        if (entry == null) return NotFound();

        _db.Remove(entry);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    private async Task<bool> CanEditAlbum(Guid albumId, Guid userId)
    {
        return await _db.Set<Album>()
            .AnyAsync(a => 
                a.Id == albumId &&
                (a.CreatedByUserId == userId ||
                 a.Group.CreatedByUserId == userId ||
                 a.Group.Members.Any(m => m.UserId == userId && m.Role == GroupRole.Admin))
            );
    }

    [HttpGet("{albumId:guid}/top-memory")]
    public async Task<ActionResult<object>> GetTopMemory(Guid groupId, Guid albumId)
    {
        var uid = User.UserId();
        await EnsureGroupMember(_db, groupId, uid);

        var query =
            from m in _db.Set<Memory>().AsNoTracking()
            where m.GroupId == groupId && m.AlbumId == albumId

            join l in _db.Set<MemoryLike>()
                on m.Id equals l.MemoryId into likes

            select new
            {
                m.Id,
                m.Type,
                MediaUrl = $"/api/groups/{groupId}/memories/{m.Id}/media",
                m.ThumbUrl,
                m.QuoteText,
                m.HappenedAt,

                LikeCount = likes.Count()
            };

        var memory = await query
            .OrderByDescending(x => x.LikeCount)
            .ThenByDescending(x => x.HappenedAt)
            .FirstOrDefaultAsync();

        if (memory == null)
            return NotFound();

        return Ok(memory);
    }

    [HttpGet("{albumId:guid}/preview-memories")]
    public async Task<ActionResult<List<object>>> GetPreviewMemories(Guid groupId, Guid albumId)
    {
        var uid = User.UserId();
        await EnsureGroupMember(_db, groupId, uid);

        var memories = await _db.Set<Memory>()
            .AsNoTracking()
            .Where(m => m.GroupId == groupId && m.AlbumId == albumId)
            .OrderByDescending(m => m.HappenedAt)
            .Take(5) // 👈 small set for story mode
            .Select(m => new
            {
                m.Id,
                m.Type,
                MediaUrl = $"/api/groups/{groupId}/memories/{m.Id}/media",
                m.QuoteText,
                m.HappenedAt
            })
            .ToListAsync();

        return Ok(memories);
    }
}

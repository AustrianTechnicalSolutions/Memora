using System.Text;
using AuthApi.Data;
using AuthApi.Models;
using AuthApi.Services;
using AuthApi.Endpoints;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Extensions.FileProviders;
using System.Threading.RateLimiting;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();

builder.Services.AddControllers();
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(
        Path.Combine(builder.Environment.ContentRootPath, "keys")));

// ---- JWT config ----
builder.Services.Configure<JwtOptions>(
    builder.Configuration.GetSection("Jwt"));

// ---- EF Core (SQLite) ----
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection")));

// ---- Security services ----
builder.Services.AddSingleton<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
builder.Services.AddSingleton<IJwtTokenService, JwtTokenService>();
builder.Services.AddSingleton<ICityLookupService, GeoNamesCityLookupService>();
builder.Services.AddSingleton<ICountryLookupService, CsvCountryLookupService>();
builder.Services.AddSingleton<AuthApi.Services.DuelService>();

// ---- Auth ----
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()!;

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey =
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
            ClockSkew = TimeSpan.FromSeconds(30)
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["token"];

                if (!string.IsNullOrEmpty(token))
                {
                    context.Token = token;
                }

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// ---- Rate Limiting ----
builder.Services.AddRateLimiter(options =>
{
    // Global default
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 600,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    options.AddPolicy("auth-login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst
            }));

    options.AddPolicy("auth-register", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 3,
                Window = TimeSpan.FromMinutes(5),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst
            }));

    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = 429;
        context.HttpContext.Response.ContentType = "application/json";

        await context.HttpContext.Response.WriteAsJsonAsync(new
        {
            error = "rate_limited",
            message = "Too many requests."
        });
    };
});

// ---- CORS (Angular) ----
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        policy
            .WithOrigins("http://localhost:4200", "https://austriants.at", "https://www.austriants.at", "https://memora.austriants.at")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()
            .SetPreflightMaxAge(TimeSpan.FromHours(1)); // browser caches OPTIONS for 1h — massively reduces preflight requests
    });
});

var app = builder.Build();
var webRootPath = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var uploadsPath = Path.Combine(app.Environment.ContentRootPath, "uploads");

Directory.CreateDirectory(uploadsPath);

app.UseCors("frontend");          // must be first so ALL responses get CORS headers

app.UseMiddleware<ExceptionMiddleware>();

app.UseHttpsRedirection();

app.UseCors("frontend");

app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

// ---- Ensure interaction tables exist (SQLite, no migrations) ----
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    /*db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS MemoryLikes (
    MemoryId TEXT NOT NULL,
    UserId TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    PRIMARY KEY (MemoryId, UserId)
);");
    db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS MemoryComments (
    Id TEXT NOT NULL PRIMARY KEY,
    MemoryId TEXT NOT NULL,
    UserId TEXT NOT NULL,
    Content TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    ParentCommentId TEXT NULL
);");
    db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS CommentLikes (
    CommentId TEXT NOT NULL,
    UserId TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    PRIMARY KEY (CommentId, UserId)
);");*/
}

app.MapControllers();

// ---- Protected test ----
app.MapGet("/api/me", (System.Security.Claims.ClaimsPrincipal user) =>
{
    return Results.Ok(new
    {
        email = user.FindFirst("email")?.Value
    });
}).RequireAuthorization();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    MarkInitialMigrationForLegacyDatabase(db);
    db.Database.Migrate();
}

app.Run();

static void MarkInitialMigrationForLegacyDatabase(AppDbContext db)
{
    var connection = db.Database.GetDbConnection();
    var shouldClose = connection.State != System.Data.ConnectionState.Open;

    if (shouldClose)
        connection.Open();

    try
    {
        ExecuteNonQuery(connection, @"
CREATE TABLE IF NOT EXISTS ""__EFMigrationsHistory"" (
    ""MigrationId"" TEXT NOT NULL CONSTRAINT ""PK___EFMigrationsHistory"" PRIMARY KEY,
    ""ProductVersion"" TEXT NOT NULL
);");

        var hasLegacySchema =
            TableExists(connection, "Group") &&
            TableExists(connection, "Users") &&
            TableExists(connection, "Memory");

        if (!hasLegacySchema)
            return;

        ExecuteNonQuery(connection, @"
INSERT OR IGNORE INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
VALUES ('20260322014236_InitialCreate', '8.0.6');");
    }
    finally
    {
        if (shouldClose)
            connection.Close();
    }
}

static bool TableExists(System.Data.Common.DbConnection connection, string tableName)
{
    using var command = connection.CreateCommand();
    command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name;";

    var parameter = command.CreateParameter();
    parameter.ParameterName = "$name";
    parameter.Value = tableName;
    command.Parameters.Add(parameter);

    return Convert.ToInt32(command.ExecuteScalar()) > 0;
}

static void ExecuteNonQuery(System.Data.Common.DbConnection connection, string sql)
{
    using var command = connection.CreateCommand();
    command.CommandText = sql;
    command.ExecuteNonQuery();
}

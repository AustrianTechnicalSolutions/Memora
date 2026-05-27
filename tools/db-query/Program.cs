// See https://aka.ms/new-console-template for more information
using Microsoft.Data.Sqlite;

var dbPath = @"c:\Users\gajip\Music\Spengergasse\4BHIF\PRE\Memora\Memora\memora-backend\memora.db";

if (!File.Exists(dbPath))
{
    Console.WriteLine("DB not found: " + dbPath);
    return;
}

using var conn = new SqliteConnection($"Data Source={dbPath}");
conn.Open();

using var cmd = conn.CreateCommand();
cmd.CommandText = "SELECT Id, Email, DisplayName FROM Users ORDER BY DisplayName";

using var reader = cmd.ExecuteReader();
while (reader.Read())
{
    var id = reader.GetString(0);
    var email = reader.GetString(1);
    var name = reader.GetString(2);
    Console.WriteLine($"{id} | {email} | {name}");
}

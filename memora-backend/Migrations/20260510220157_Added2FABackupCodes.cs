using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace memorabackend.Migrations
{
    /// <inheritdoc />
    public partial class Added2FABackupCodes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TwoFactorBackupCodesJson",
                table: "Users",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TwoFactorBackupCodesJson",
                table: "Users");
        }
    }
}

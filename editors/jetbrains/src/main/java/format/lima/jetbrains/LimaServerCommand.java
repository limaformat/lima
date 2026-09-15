package format.lima.jetbrains;

import java.util.List;

final class LimaServerCommand {
    private LimaServerCommand() {
    }

    static List<String> command() {
        return commandForOs(System.getProperty("os.name", ""));
    }

    static List<String> commandForOs(String osName) {
        List<String> server = List.of(
                "npx",
                "--yes",
                "@limaformat/lima-language-server",
                "--stdio"
        );
        if (!osName.regionMatches(true, 0, "Windows", 0, "Windows".length())) {
            return server;
        }
        return List.of(
                "cmd.exe",
                "/d",
                "/c",
                server.get(0),
                server.get(1),
                server.get(2),
                server.get(3)
        );
    }
}

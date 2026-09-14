package format.lima.jetbrains;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

final class LimaServerCommandTest {
    @Test
    void startsThePublishedServerDirectlyOnUnix() {
        assertEquals(
                List.of(
                        "npx",
                        "--yes",
                        "@limaformat/lima-language-server",
                        "--stdio"
                ),
                LimaServerCommand.commandForOs("Linux")
        );
    }

    @Test
    void startsThePublishedServerThroughCmdOnWindows() {
        assertEquals(
                List.of(
                        "cmd.exe",
                        "/c",
                        "npx",
                        "--yes",
                        "@limaformat/lima-language-server",
                        "--stdio"
                ),
                LimaServerCommand.commandForOs("Windows 11")
        );
    }
}

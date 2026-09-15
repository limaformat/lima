package format.lima.jetbrains;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.File;
import org.junit.jupiter.api.Test;

final class LimaLanguageServerTest {
    @Test
    void usesTheProjectDirectoryAsTheServerWorkingDirectory() {
        File projectRoot = new File("/tmp/lima-project-root");
        assertEquals(
                projectRoot,
                LimaLanguageServer.commandLine(projectRoot.getPath()).getWorkDirectory()
        );
    }

    @Test
    void leavesTheWorkingDirectoryUnsetWithoutAProjectBasePath() {
        assertNull(LimaLanguageServer.commandLine(null).getWorkDirectory());
    }
}

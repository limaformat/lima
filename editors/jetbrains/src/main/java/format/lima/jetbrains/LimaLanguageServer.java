package format.lima.jetbrains;

import com.intellij.execution.configurations.GeneralCommandLine;
import com.redhat.devtools.lsp4ij.server.OSProcessStreamConnectionProvider;

final class LimaLanguageServer extends OSProcessStreamConnectionProvider {
    LimaLanguageServer(String projectBasePath) {
        setCommandLine(commandLine(projectBasePath));
    }

    static GeneralCommandLine commandLine(String projectBasePath) {
        GeneralCommandLine commandLine = new GeneralCommandLine(LimaServerCommand.command());
        if (projectBasePath != null) {
            commandLine.withWorkDirectory(projectBasePath);
        }
        return commandLine;
    }
}

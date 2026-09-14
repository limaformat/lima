package format.lima.jetbrains;

import com.intellij.execution.configurations.GeneralCommandLine;
import com.redhat.devtools.lsp4ij.server.OSProcessStreamConnectionProvider;

final class LimaLanguageServer extends OSProcessStreamConnectionProvider {
    LimaLanguageServer() {
        setCommandLine(new GeneralCommandLine(LimaServerCommand.command()));
    }
}

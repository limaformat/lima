plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.9.0"
}

group = "format.lima"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.2")
        plugin("com.redhat.devtools.lsp4ij:0.21.0")
    }

    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.11.4")
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = "242"
        }
    }
}

tasks.test {
    useJUnitPlatform()
}

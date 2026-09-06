import os
import shutil
import subprocess

# Settings
SOURCE_DIR = os.getcwd()
BUILD_DIR = os.path.join(os.path.expanduser("~"), "TempGateFlameBuild")
APK_DESTINATION = os.path.join(SOURCE_DIR, "app-debug.apk")

def build_safe():
    print(f"--- Starting Clean Build Process ---")
    
    # 1. Create clean build directory
    if os.path.exists(BUILD_DIR):
        print(f"Cleaning existing build dir...")
        shutil.rmtree(BUILD_DIR, ignore_errors=True)
    
    print(f"Copying project to clean path: {BUILD_DIR}")
    # Ignore heavy and locked folders to speed up copy and avoid lock errors
    shutil.copytree(SOURCE_DIR, BUILD_DIR, ignore=shutil.ignore_patterns('node_modules', '.git', '.artifacts', 'dist', '.gradle_home', '.android_home'))
    
    os.chdir(BUILD_DIR)
    
    # 2. Locate JDK
    jdk_path = r"E:\Program Files (x86)\AndroidStudio\jbr"
    if not os.path.exists(jdk_path):
        jdk_path = r"C:\Program Files\Android\Android Studio\jbr"
    
    print(f"Using JDK: {jdk_path}")
    os.environ["JAVA_HOME"] = jdk_path
    os.environ["PATH"] = os.path.join(jdk_path, "bin") + os.pathsep + os.environ["PATH"]
    
    # Set Android specific homes to the build dir to avoid caret issues in global paths
    android_user_home = os.path.join(BUILD_DIR, ".android_user")
    gradle_user_home = os.path.join(BUILD_DIR, ".gradle_user")
    os.makedirs(android_user_home, exist_ok=True)
    os.makedirs(gradle_user_home, exist_ok=True)
    
    os.environ["ANDROID_USER_HOME"] = android_user_home
    os.environ["GRADLE_USER_HOME"] = gradle_user_home
    
    # Ensure Android SDK is correctly pointed
    os.environ["ANDROID_HOME"] = r"C:\Users\DGMic\AppData\Local\Android\Sdk"
    os.environ["ANDROID_SDK_ROOT"] = r"C:\Users\DGMic\AppData\Local\Android\Sdk"
    
    try:
        # 3. Build Web Assets
        print("Installing dependencies...")
        subprocess.run(["npm.cmd", "install"], shell=True, check=True)
        
        print("Building Web assets...")
        subprocess.run(["node", "node_modules/vite/bin/vite.js", "build"], shell=True, check=True)
        
        print("Syncing Capacitor...")
        subprocess.run(["node", "node_modules/@capacitor/cli/bin/capacitor", "sync", "android"], shell=True, check=True)
        
        # 4. Build APK
        print("Building Android APK (this may take a few minutes)...")
        gradle_bat = os.path.join(BUILD_DIR, "android", "gradlew.bat")
        # Passing system properties to force locations
        subprocess.run([
            gradle_bat, 
            f"-Dgradle.user.home={gradle_user_home}",
            f"-Dandroid.user.home={android_user_home}",
            "assembleDebug"
        ], cwd=os.path.join(BUILD_DIR, "android"), shell=True, check=True)
        
        # 5. Retrieve APK
        generated_apk = os.path.join(BUILD_DIR, r"android\app\build\outputs\apk\debug\app-debug.apk")
        if os.path.exists(generated_apk):
            shutil.copy(generated_apk, APK_DESTINATION)
            print(f"\nSUCCESS! APK copied to: {APK_DESTINATION}")
        else:
            print("\nError: APK was not found after build.")
            
    finally:
        os.chdir(SOURCE_DIR)

if __name__ == "__main__":
    build_safe()

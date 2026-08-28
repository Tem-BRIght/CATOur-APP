import pathlib  
def print_range(path, start, end):  
    lines=pathlib.Path(path).read_text().splitlines()  
    for i in range(start-1, end):  
        print(f'{path}:{i+1}: {lines[i]}')  
if __name__ == '__main__':  
    print_range('src\App.tsx', 100, 117)  
    print()  
    print_range('src\components\NativePushNotificationsBootstrap.tsx', 1, 60)  
    print()  
    print_range('src\context\AuthContext.tsx', 50, 180)  
    print()  
    print_range('src\pages\Login\Login.tsx', 1, 220)  
    print()  
    print_range('src\pages\Splash\SplashScreen.tsx', 1, 45)  
    print()  
    print_range('src\services\pushNotificationsService.ts', 1, 120)  

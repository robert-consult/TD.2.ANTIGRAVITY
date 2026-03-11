#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <Firebase.h>
#import <UserNotifications/UserNotifications.h>

@interface AppDelegate ()
@property (nonatomic, strong) UIVisualEffectView *privacyShieldView;
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // Initialize Firebase for push notifications
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }
  
  // Request notification permissions
  if (@available(iOS 10.0, *)) {
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    center.delegate = self;
  }
  
  self.moduleName = @"TradeQuipNative";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (void)applicationWillResignActive:(UIApplication *)application
{
  [self installPrivacyShield];
}

- (void)applicationDidEnterBackground:(UIApplication *)application
{
  [self installPrivacyShield];
}

- (void)applicationWillEnterForeground:(UIApplication *)application
{
  [self removePrivacyShield];
}

- (void)applicationDidBecomeActive:(UIApplication *)application
{
  [self removePrivacyShield];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self getBundleURL];
}

- (NSURL *)getBundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

#pragma mark - Push Notification Handling

// Handle remote notification registration
- (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken
{
  [FIRMessaging messaging].APNSToken = deviceToken;
}

- (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
{
  NSLog(@"Failed to register for remote notifications: %@", error);
}

// Handle incoming notifications when app is in foreground (iOS 10+)
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler
{
  NSDictionary *userInfo = notification.request.content.userInfo;
  NSLog(@"Foreground notification received: %@", userInfo);
  
  // Show notification even when app is in foreground
  if (@available(iOS 14.0, *)) {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound | UNNotificationPresentationOptionBadge);
  } else {
    completionHandler(UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionSound | UNNotificationPresentationOptionBadge);
  }
}

// Handle notification tap (iOS 10+)
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler
{
  NSDictionary *userInfo = response.notification.request.content.userInfo;
  NSLog(@"Notification tapped: %@", userInfo);
  
  completionHandler();
}

- (void)installPrivacyShield
{
  if (self.privacyShieldView != nil || self.window == nil) {
    return;
  }

  UIBlurEffect *effect = [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemChromeMaterial];
  UIVisualEffectView *blurView = [[UIVisualEffectView alloc] initWithEffect:effect];
  blurView.frame = self.window.bounds;
  blurView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  blurView.userInteractionEnabled = NO;
  [self.window addSubview:blurView];
  self.privacyShieldView = blurView;
}

- (void)removePrivacyShield
{
  [self.privacyShieldView removeFromSuperview];
  self.privacyShieldView = nil;
}

@end
